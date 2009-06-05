var CONFIG = { debug: false
             , nick: "#"   // set in onConnect
             , id: null    // set in onConnect
             , last_message_time: 0
             };

var nicks = [];

function updateUsersLink ( ) {
  $("#usersLink").text(nicks.length.toString() + " users");
}

function userJoin(nick, timestamp) {
  addMessage(nick, "joined", timestamp, "join");
  for (var i = 0; i < nicks.length; i++)
    if (nicks[i] == nick) return;
  nicks.push(nick);
  updateUsersLink();
}

function userPart(nick, timestamp) {
  addMessage(nick, "left", timestamp, "part");
  for (var i = 0; i < nicks.length; i++) {
    if (nicks[i] == nick) {
      nicks.splice(i,1)
      break;
    }
  }
  updateUsersLink();
}

// utility functions

util = {
  urlRE: /https?:\/\/([-\w\.]+)+(:\d+)?(\/([^\s]*(\?\S+)?)?)?/g, 

  //  html sanitizer 
  toStaticHTML: function(inputHtml) {
    return inputHtml.replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");
  }, 

  zeroPad: function (digits, n) {
    n = n.toString();
    while (n.length < digits) 
      n = '0' + n;
    return n;
  },

  timeString: function (date) {
    var minutes = date.getMinutes().toString();
    var hours = date.getHours().toString();
    return this.zeroPad(2, hours) + ":" + this.zeroPad(2, minutes);
  },

  isBlank: function(text) {
    var blank = /^\s*$/;
    return (text.match(blank) !== null);
  }
};

function scrollDown () {
  window.scrollBy(0, 100000000000000000);
  $("#entry").focus();
}

function addMessage (from, text, time, _class) {
  if (text === null)
    return;
  
  if (time !== null)
    time = new Date();

  var messageElement = $(document.createElement("table"));

  messageElement.addClass("message");
  if (_class)
    messageElement.addClass(_class);

  // sanitize
  text = util.toStaticHTML(text);

  // See if it matches our nick?
  var nick_re = new RegExp(CONFIG.nick);
  if (nick_re.exec(text))
    messageElement.addClass("personal");

  // replace URLs with links
  text = text.replace(util.urlRE, '<a target="_blank" href="$&">$&</a>');

  var content = '<tr>'
              + '  <td class="date">' + util.timeString(time) + '</td>'
              + '  <td class="nick">' + util.toStaticHTML(from) + '</td>'
              + '  <td class="msg-text">' + text  + '</td>'
              + '</tr>'
              ;
  messageElement.html(content);

  $("#log").append(messageElement);
  scrollDown();
}

function matchingNicks (partial) {
  var re = new RegExp(partial);
  var matching = [];
  for (var i = 0; i < nicks.length; i++) {
    if (re.exec(nicks[i])) matching.push(nicks[i]);
  }
  return matching;
}

function clearEntry () {
  $("#entry").attr("value", "");
}

// for tab completion. a list of possible nicks.
var completionList = null;
var commandHistory = [""];
var commandHistoryIndex = 0;

function handleKeyPress (e) {
  //console.log("key press " + e.keyCode.toString());
  if (e.keyCode == 9 /* tab */) {
    if (completionList === null) {
      // try to complete a nickname.
      var enteredText = $("#entry").attr("value");
      var words = enteredText.split(/\s+/);
      if (words.length > 1) { 
        $("#entry").focus();
        return;
      }
      var partial = words[0];
      completionList = matchingNicks(partial);
    }

    var possibility = (completionList.shift() || "") + ": ";
    $("#entry").attr("value", possibility);
    $("#entry").focus();
    e.preventDefault();
    return;
  }
  // not tab? clear completionList 
  completionList = null;

  if (e.keyCode == 38 /* up */) {
    commandHistoryIndex += 1;
    if (commandHistoryIndex == commandHistory.length)
      commandHistoryIndex = commandHistory.length - 1;
    $("#entry").attr("value", commandHistory[commandHistoryIndex]);
    return;
  }
  if (e.keyCode == 40 /* down */) {
    commandHistoryIndex -= 1;
    if (commandHistoryIndex < 0)
      commandHistoryIndex = 0;
    $("#entry").attr("value", commandHistory[commandHistoryIndex]);
    return;
  }

  var msg = $("#entry").attr("value").replace("\n", "");
  commandHistory[0] = msg;
  commandHistoryIndex = 0;

  if (e.keyCode != 13 /* Return */) return;

  if (!util.isBlank(msg)) {
    send(msg);
  }

  commandHistory.unshift("");
  clearEntry();
};

var transmission_errors = 0;
var first_poll = true;

function longPoll (data) {
  if (transmission_errors > 2) {
    showConnect();
    return;
  }

  if (data && data.messages) {
    for (var i = 0; i < data.messages.length; i++) {
      var message = data.messages[i];

      if (message.timestamp > CONFIG.last_message_time)
        CONFIG.last_message_time = message.timestamp;

      switch (message.type) {
        case "msg":
          addMessage(message.nick, message.text, message.timestamp);
          break;

        case "join":
          userJoin(message.nick, message.timestamp);
          break;

        case "part":
          userPart(message.nick, message.timestamp);
          break;
      }
    }
    if (first_poll) {
      first_poll = false;
      who();
    }
  }

  $.ajax({ cache: false
         , type: "GET"
         , url: "/recv"
         , dataType: "json"
         , data: { since: CONFIG.last_message_time, id: CONFIG.id }
         , error: function () {
             addMessage("", "long poll error. trying again...", new Date(), "error");
             transmission_errors += 1;
             setTimeout(longPoll, 10*1000);
           }
         , success: function (data) {
             transmission_errors = 0;
             longPoll(data);
           }
         });
}

function send(msg) {
  if (CONFIG.debug === false) {
    // XXX should be POST
    jQuery.get("/send", {id: CONFIG.id, text: msg}, function (data) { }, "json");
  }
}

function showConnect () {
  $("#connect").show();
  $("#loading").hide();
  $("#toolbar").hide();
  $("#nickInput").focus();
}

function showLoad () {
  $("#connect").hide();
  $("#loading").show();
  $("#toolbar").hide();
}

function showChat (nick) {
  $("#nick").text(nick);
  $("#toolbar").show();
  $("#entry").focus();

  $("#connect").hide();
  $("#loading").hide();

  scrollDown();
}

function onConnect (session) {
  if (session.error) {
    alert("error connecting: " + session.error);
    showConnect();
    return;
  }

  CONFIG.nick = session.nick;
  CONFIG.id   = session.id;

  showChat(CONFIG.nick);
}

function who () {
  jQuery.get("/who", {}, function (data, status) {
    if (status != "success") return;
    nicks = data.nicks;
    var nick_string = nicks.length > 0 ? nicks.join(", ") : "(none)";
    addMessage("users:", nick_string, new Date(), "notice");
  }, "json");
}

$(document).ready(function() {

  $("#entry").keypress(handleKeyPress);

  $("#usersLink").click(who);

  $("#connectButton").click(function () {
    showLoad();
    var nick = $("#nickInput").attr("value");

    if (nick.length > 50) {
      alert("Nick too long. 50 character max.");
      showConnect();
      return false;
    }

    if (/[^\w_\-^!]/.exec(nick)) {
      alert("Bad character in nick. Can only have letters, numbers, and '_', '-', '^', '!'");
      showConnect();
      return false;
    }

    $.ajax({ cache: false
           , type: "GET" // XXX should be POST
           , dataType: "json"
           , url: "/join"
           , data: { nick: nick }
           , error: function () {
               alert("error connecting to server");
               showConnect();
             }
           , success: onConnect
           });
    return false;
  });

  // update the clock every second
  setInterval(function () {
    var now = new Date();
    $("#currentTime").text(util.timeString(now));
  }, 1000);

  if (CONFIG.debug) {
    $("#loading").hide();
    $("#connect").hide();
    scrollDown();
    return;
  }

  // remove fixtures
  $("#log table").remove();

  longPoll();

  showConnect();
});

$(window).unload(function () {
  jQuery.get("/part", {id: CONFIG.id}, function (data) { }, "json");
});
