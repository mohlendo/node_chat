var sys = require("sys"),
    tcp = require("tcp");

var CRLF = "\r\n";

function dbg(s) { sys.debug(s); }

/**
 * Constructs a new Redis client, calling "callback" if successfully connected.
 */
function Redis(callback, port, host) {
  this.callbacks = [];
  
  this.conn = tcp.createConnection(port || 6379, host || '127.0.0.1');
  this.conn.setEncoding("binary");
  this.conn.setTimeout(0);
  if (callback) {
    var redis = this;
    this.conn.addListener("connect", function() {
      callback(redis);
    });
  }

  var redis = this, buffer = "", count = 0, n = 0, result = null;
  
  this.conn.addListener("receive", function(data) {
    function reply(obj) {
      if (n > 0) {
        dbg("storing " + obj);
        result.push(obj);
        obj = result;
        n -= 1;
      }
      if (n == 0) {
        dbg("returning " + obj);
        redis.callbacks.shift().emitSuccess(obj);
      }
    }
    
    dbg("receive: " + data);
    buffer += data;
    while (true) {
      if (count > 0) {
        dbg("waiting for " + count + " bytes...")
        if (buffer.length < count) {
          dbg("not enough, only " + buffer.length);
          return;
        }
        var chunk = buffer.substring(0, count - 2);
        buffer = buffer.substring(count);
        count = 0;
        dbg("got chunk " + chunk);
        reply(chunk);
      } else {
        dbg("waiting for line")
        var end = buffer.indexOf(CRLF);
        if (end == -1) {
          dbg("no CRLF");
          return;
        }
        var command = buffer[0];
        var line = buffer.substring(1, end);
        buffer = buffer.substring(end + 2);
        switch (command) {
          case '+':
            dbg("got line: " + line);
            reply(line);
            break;
          case ':':
            dbg("got line: " + line);
            reply(parseInt(line, 10));
            break;
          case '$':
            var c = parseInt(line, 10);
            dbg("bulk reply detected " + c)
            if (c == -1) {
              dbg("got null");
              reply(null);
            } else {
              count = c + 2;
              continue;
            }
            break;
          case '*':
            n = parseInt(line, 10);
            if (n == -1) {
              n = 0;
              dbg("got null");
              reply(null);
            } else {
              dbg("multi bulk reply " + n);
              result = [];
              continue;
            }
            break;
          case '-':
            dbg("error " + line);
            redis.callbacks.shift().emitError(line);
            break;
          default:
            dbg("unexpected " + command + line);
        }
      }
    }
  });
}

Redis.prototype._send = function(command) {
  var promise = new process.Promise;
  this.callbacks.push(promise);
  this.conn.send(command + CRLF, "binary");
  return promise;
};

Redis.prototype.close = function() {
  this._send("QUIT").addCallback(function() {
    this.conn.close();
  });
};

Redis.prototype.ping = function(callback) {
  return this._send("PING");
};

// commands operating on string values

Redis.prototype.set = function(key, value) {
  return this._send("SET " + key + " " + value.length + CRLF + value);
};

Redis.prototype.get = function(key) {
  return this._send("GET " + key);
};

Redis.prototype.getset = function(key, value) {
  return this._send("GETSET " + key + " " + value.length + CRLF + value);
};

// mget, setnx

Redis.prototype.incr = function(key, by) {
  if (by) {
    return this._send("INCRBY " + key + " " + by);
  }
  return this._send("INCR " + key);
};

Redis.prototype.decr = function(key, by) {
  if (by) {
    return this._send("DECRBY " + key + " " + by);
  }
  return this._send("DECR " + key);
};

// exists, del, type

// commands operating on the key space

Redis.prototype.dbSize = function() {
  return this._send("DBSIZE");
};

// ....

// commands operating on lists

Redis.prototype.rpush = function(key, value) {
  return this._send("RPUSH " + key + " " + value.length + CRLF + value);
};

Redis.prototype.lpush = function(key, value) {
  return this._send("LPUSH " + key + " " + value.length + CRLF + value);
};

Redis.prototype.llen = function(key) {
  return this._send("LLEN " + key);
};

Redis.prototype.lrange = function(key, from, to) {
  return this._send("LRANGE " + key + " " + from + " " + to);
};

// commands operating on sets
// commands operating on sorted sets

// multiple databases handling commmands

Redis.prototype.select = function(index) {
  return this._send("SELECT " + index);
};

Redis.prototype.move = function(key, index) {
  return this._send("MOVE " + key + " " + index);
};

Redis.prototype.flushdb = function() {
  return this._send("FLUSHDB");
};

Redis.prototype.flushall = function() {
  return this._send("FLUSHALL");
};

exports.Redis = Redis;
