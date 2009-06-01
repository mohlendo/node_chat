var fu = require("fu");

var MESSAGE_BACKLOG = 200;
var SESSION_TIMEOUT = 60 * 1000;


var channel = new function () {
  var messages = [];
  var callbacks = [];

  this.appendMessage = function (nick, message) {
    var m = { nick: nick
            , text: message
            , timestamp: (new Date()).getTime()
            };

    messages.push( m );

    while (callbacks.length > 0) {
      callbacks.shift().callback([m]);
    }

    while (messages.length > MESSAGE_BACKLOG)
      messages.shift();
  };

  this.query = function (since, callback) {
    var matching = [];
    for (var i = 0; i < messages.length; i++) {
      var message = messages[i];
      if (message.timestamp > since)
        matching.push(message)
    }

    if (matching.length != 0) {
      callback(matching);
    } else {
      callbacks.push({ timestamp: new Date(), callback: callback });
    }
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
  for (var i in sessions) {
    var session = sessions[i];
    if (session && session.nick === nick)
      return null;
  }
  var session = { nick: nick 
                , id: Math.floor(Math.random()*99999999999).toString()
                , timestamp: new Date()
                };
  session.poke = function () {
    session.timestamp = new Date();
  }
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
      delete sessions[id];
    }
  }
}, 1000);

function onLoad () {
  fu.listen(7000);

  fu.get("/", fu.staticHandler("index.html"));
  fu.get("/style.css", fu.staticHandler("style.css"));
  fu.get("/client.js", fu.staticHandler("client.js"));
  fu.get("/jquery-1.2.6.min.js", fu.staticHandler("jquery-1.2.6.min.js"));

  fu.get("/connect", function (req, res) {
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

    res.simpleJSON(200, { id: session.id, nick: session.nick});
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

    channel.appendMessage(session.nick, text);
    res.simpleJSON(200, {});
  });
}
