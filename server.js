HOST = null; // localhost
PORT = 8001;
GLOBAL.DEBUG = true;

var fu = require("./fu");
var sys = require("sys");
var http = require("http");
var redis = require("./redis");

var MESSAGE_BACKLOG = 200;
var SESSION_TIMEOUT = 60 * 1000;
var CHAT_DB_NUMBER  = 7;
var ROOM = "room:1";

var rclient = new redis.Redis(function(r) {
    r.select(CHAT_DB_NUMBER);
    });

var channel = new function () {
  var callbacks = [];
  this.appendMessage = function (nick, type, text) {
    rclient.llen(ROOM).addCallback(function (value) { 
        sys.debug("next index " + value);
        var m = { index: value
        , nick: nick
        , type: type // "msg", "join", "part"
        , text: text
        , timestamp: (new Date()).getTime()
        };
        rclient.rpush(ROOM, JSON.stringify(m));

        while (callbacks.length > 0) {
          callbacks.shift().callback([m]);
        }
    });
  };

  this.query = function (since, callback) {
    rclient.llen(ROOM).addCallback( function(value) { 
      if(since < value-1) {
        rclient.lrange(ROOM, since, -1).addCallback( function(values) {
          var matching = [];
          if (values) {
            for(var i = 0; i < values.length; i++) {
              var message = JSON.parse(values[i]);
              matching.push(message);
            }
          }
          callback(matching);
        });
      } else {
        callbacks.push({ timestamp: new Date(), callback: callback });
      }
    });
  };

  // clear old callbacks
  // they can hang around for at most 30 seconds.
  setInterval(function () {
    var now = new Date();
    while (callbacks.length > 0 && now - callbacks[0].timestamp > 30*1000) {
      callbacks.shift().callback([]);
    }
  }, 1000);
};

var sessions = {};

function createSession (nick) {
  if (nick.length > 50) return null;
  if (/[^\w_\-^!]/.exec(nick)) return null;

  for (var i in sessions) {
    var session = sessions[i];
    if (session && session.nick === nick) return null;
  }

  var session = { 
    nick: nick, 

    id: Math.floor(Math.random()*99999999999).toString(),

    timestamp: new Date(),

    poke: function () {
      session.timestamp = new Date();
    },

    destroy: function () {
      channel.appendMessage(session.nick, "part", session.nick + " parted");
      delete sessions[session.id];
    }
  };

  sessions[session.id] = session;
  return session;
}

// interval to kill off old sessions
setInterval(function () {
  var now = new Date();
  for (var id in sessions) {
    if (!sessions.hasOwnProperty(id)) continue;
    var session = sessions[id];

    if (now - session.timestamp > SESSION_TIMEOUT) {
      session.destroy();
    }
  }
}, 1000);

fu.listen(PORT, HOST);

fu.get("/", fu.staticHandler("index.html"));
fu.get("/style.css", fu.staticHandler("style.css"));
fu.get("/client.js", fu.staticHandler("client.js"));
fu.get("/jquery-1.2.6.min.js", fu.staticHandler("jquery-1.2.6.min.js"));


fu.get("/who", function (req, res) {
  var nicks = [];
  for (var id in sessions) {
    if (!sessions.hasOwnProperty(id)) continue;
    var session = sessions[id];
    nicks.push(session.nick);
  }
  res.simpleJSON(200, { nicks: nicks });
});

fu.get("/join", function (req, res) {
  var nick = req.uri.params["nick"];
  if (nick == null || nick.length == 0) {
    res.simpleJSON(400, {error: "Bad nick."});
    return;
  }
  var session = createSession(nick);
  if (session == null) {
    res.simpleJSON(400, {error: "Nick in use"});
    return;
  }

  //sys.puts("connection: " + nick + "@" + res.connection.remoteAddress);

  channel.appendMessage(session.nick, "join", session.nick + " joined");
  res.simpleJSON(200, { id: session.id, nick: session.nick});
});

fu.get("/part", function (req, res) {
  var id = req.uri.params.id;
  var session;
  if (id && sessions[id]) {
    session = sessions[id];
    session.destroy();
  }
  res.simpleJSON(200, { });
});

fu.get("/recv", function (req, res) {
  if (!req.uri.params.since) {
    res.simpleJSON(400, { error: "Must supply since parameter" });
    return;
  }
  var id = req.uri.params.id;
  var session;
  if (id && sessions[id]) {
    session = sessions[id];
    session.poke();
  }

  var since = parseInt(req.uri.params.since, 10);
  channel.query(since, function (messages) {
    if (session) session.poke();
    res.simpleJSON(200, { messages: messages });
  });
});

fu.get("/send", function (req, res) {
  var id = req.uri.params.id;
  var text = req.uri.params.text;

  var session = sessions[id];
  if (!session || !text) {
    res.simpleJSON(400, { error: "No such session id" });
    return; 
  }

  session.poke();

  channel.appendMessage(session.nick, "msg", text);
  res.simpleJSON(200, {});
});
