HOST = null; // localhost
PORT = 8001;
GLOBAL.DEBUG = true;

var fu = require("./fu");
var sys = require("sys");
var http = require("http");
var redis = require("./redis");

var MESSAGE_BACKLOG = 200;
var CALLBACK_TIMEOUT = 30 * 1000;
var SESSION_TIMEOUT = 2 * CALLBACK_TIMEOUT;
var CHAT_DB_NUMBER  = 7;
var DEFAULT_CHANNEL = "default";

var rclient = new redis.Redis(function(r) {
    r.select(CHAT_DB_NUMBER);
    });

var channels = {};

function createChannel(name) {
  var channel = new function () {
    var members = {};
    var nMembers = 0;

    this.name = name;

    this.join = function (session, text) {
      if (!members[session.id]) {
        sys.puts("channel.join(" + session.nick + ", " + this.name + ")");
        members[session.id] = { timestamp: new Date(), session: session };
        nMembers++;
        this.appendMessage(session.nick, "join", text);
      }
    };

    this.leave = function (session, text) {
      if (members[session.id]) {
        sys.puts("channel.leave(" + session.nick + ", " + this.name + ")");
        this.appendMessage(session.nick, "part", text)
        delete members[session.id];
        nMembers--;
      }
    };

    this.getNumberOfMembers = function() {
      return nMembers;
    };

    this.getMembers = function() {
      var nicks = [];
      for (sessionId in members) {
        if (!members.hasOwnProperty(sessionId)) continue;
        nicks.push(members[sessionId].session.nick);
      }
      return nicks;
    };

    this.appendMessage = function (nick, type, text) {
      rclient.llen(name).addCallback(function (value) { 
          var m = { index: value
          , nick: nick
          , type: type // "msg", "join", "part"
          , text: text
          , timestamp: (new Date()).getTime()
          };
          rclient.rpush(name, JSON.stringify(m));

          for (var sessionId in members) {
            if (!members.hasOwnProperty(sessionId)) continue;
            members[sessionId].session.deliver([m]);
          }
      });
    };

    this.query = function (since, callback) {
      rclient.llen(name).addCallback( function(value) { 
        if(since < value-1) {
          rclient.lrange(name, since, -1).addCallback( function(values) {
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
          callback([]);
        }
      });
    };
  };

  channels[name] = channel;
  return channel;
}

createChannel(DEFAULT_CHANNEL);

var sessions = {};

function createSession (nick) {
  if (nick.length > 50) return null;
  if (/[^\w_\-^!]/.exec(nick)) return null;

  for (var i in sessions) {
    var session = sessions[i];
    if (session && session.nick === nick) return null;
  }

  var session = new function() { 
    this.nick = nick; 

    this.id = Math.floor(Math.random()*99999999999).toString();

    this.channel = channels[DEFAULT_CHANNEL];

    this.timestamp = new Date();

    // function (messages)
    this.callback = null;

    // private messages are transient and will be delivered in-band to this session
    this.systemMessages = [];

    this.poke = function () {
      this.timestamp = new Date();
    };

    this.destroy = function () {
      this.channel.leave(this, this.nick + " parted");
      delete sessions[this.id];
    };

    this.switchTo = function (channelName) {
      if (this.channel.name !== channelName) {
        this.channel.leave(this, "left " + this.channel.name);
        this.channel = channels[channelName] || createChannel(channelName);
        this.channel.join(this, "enters " + this.channel.name);
      }
    };

    this.query = function (since, callback) {
      if (this.systemMessages.length > 0) {
        callback(this.systemMessages);
        this.systemMessages.clear();
      } else {
        var s = this;
        this.channel.query(since, function(messages) {
          if (messages.length > 0) {
            callback(messages);
          } else {
            s.callback = { timestamp: new Date(), callback: callback };
          }
        });
      }
    };

    this.deliver = function (messages) {
      if (this.callback) {
        this.callback.callback(messages || []);
        this.callback = null;
      }
    };

    this.sendSystemMessage = function (text) {
      var message = { 
        nick: "system",
        type: "msg",
        text: text,
        timestamp: (new Date()).getTime()
      };
      
      if (this.callback) {
        this.deliver([message]);
      } else {
        this.systemMessages.push(message);
      }
    };

    this.validate = function() {
      var now = new Date();
      if (now - this.timestamp > SESSION_TIMEOUT) {
        this.destroy();
      } else if (this.callback && (now - this.callback.timestamp > CALLBACK_TIMEOUT)) {
        this.deliver();
      }
    };
  };

  sessions[session.id] = session;
  session.channel.join(session, session.nick + " joined");
  return session;
}

// interval to kill off old sessions
setInterval(function () {
  var now = new Date();
  for (var id in sessions) {
    if (!sessions.hasOwnProperty(id)) continue;
    sessions[id].validate();
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

  res.simpleJSON(200, { id: session.id, nick: session.nick, channel: session.channel.name, nicks: session.channel.getMembers() });
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

    var since = parseInt(req.uri.params.since, 10);
    session.query(since, function(messages) {
      session.poke();
      res.simpleJSON(200, { messages: messages });
    });
  }
});

var commands = {
  "join": function(session, args) { session.switchTo(args[0]); },
  "leave": function(session) { session.switchTo(DEFAULT_CHANNEL); },
  "whoami": function(session) { session.sendSystemMessage("You are " + session.nick); },
  "where": function(session) { session.sendSystemMessage("You are in channel '" + session.channel.name + "'."); },
  "channels": function(session) {
    var names  = [];
    for (var name in channels) {
      if (!channels.hasOwnProperty(name)) continue;
      var label = "'" + name + "' (" + channels[name].getNumberOfMembers() + ")" + (name == session.channel.name ? "*" : "");
      names.push(label);
    }
    session.sendSystemMessage("Available channels are " + names.join(", "));
  },
  "who": function(session) {
    var allNicks = session.channel.getMembers();

    // remove own name
    var nicks = [];
    for (var i in allNicks) {
      var nick = allNicks[i];
      if (nick !== session.nick)
        nicks.push(nick);
    }

    var text = (nicks.length > 0) ? (nicks.join(", ") + (nicks.length == 1 ? " is" : " are") + " here with you.") :
      "You are all alone. Try /channels to find channels with someone to talk to.";
    session.sendSystemMessage(text);
  },
  "flush": function(session) {
    rclient.flushdb();
  },
  "help": function(session) {
    var cmdNames = [];
    for (cmd in commands) {
      if (!commands.hasOwnProperty(cmd)) continue;
      cmdNames.push("/"+cmd);
    }
    session.sendSystemMessage("Available commands: " + cmdNames.join(", "));
  }
};
 
fu.get("/send", function (req, res) {
  var id = req.uri.params.id;
  var text = req.uri.params.text;

  var session = sessions[id];
  if (!session || !text) {
    res.simpleJSON(400, { error: "No such session id" });
    return; 
  }

  session.poke();
  
  var match = text.match(/^\/(\S+)\s*(.+)?$/);
  var response = {};
  if (match) {
    sys.puts(match.length + " " + match)
    var command = commands[match[1]];
    if (command) {
      command(session, match[2] ? match[2].split(/\s/) : []);
      response["channel"] = session.channel.name;
      response["nicks"] = session.channel.getMembers();
    }
  } else {
    session.channel.appendMessage(session.nick, "msg", text);
  }
  res.simpleJSON(200, response);
});
