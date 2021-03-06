var fs = require('fs'),
    express = require('express'),
    app = express(),
    bcrypt = require('bcrypt');
    passport = require('passport'),
    sprintf = require('../js/sprintf.min.js').sprintf,
    LocalStrategy = require('passport-local').Strategy;

const DATA_DIR = "/share/Collected_Data/";

var mongoose = require('mongoose');
mongoose.connect("mongodb://localhost/mydb");
// 0) If this server.js failed to launch, first check whether mongod is running.
//    Second, unlock mongodb by "rm /var/lib/mongodb/mongod.lock"
// 1) To delete the whole data, type "mongo" in bash, and
// > use mydb
// > db.dropDatabase()
// 2) To list all users in the database, type "mongo" in bash, and
// > use mydb
// > db.userauths.find()

var localUserSchema = new mongoose.Schema({
  username: String,
  fullname: String,
  salt: String,
  hash: String
});

var Users = mongoose.model('userauths', localUserSchema);

(function () {

  staticRoute("js");
  staticRoute("css");
  staticRoute("images");

  app.use(express.cookieParser());
  // app.use(express.bodyParser());
  app.use(express.json({limit: '50mb'}));
  app.use(express.urlencoded({limit: '50mb'}));
  app.use(express.session({ secret: 'secret key of my audio-recorder-server' }));
  app.use(passport.initialize());
  app.use(passport.session());

  app.set('views', __dirname);
  app.engine('html', require('ejs').renderFile);

  function staticRoute(folder) {
    app.use('/' + folder, express.static(__dirname + './../' + folder));
  }
})()

passport.use(new LocalStrategy(
  function(username, password, done) {

    console.log('use LocalStrategy');
    Users.findOne({ username : username}, function(err,user) {

      if(err)
	return done(err);

      if(!user)
	return done(null, false, { message: 'Incorrect username.' });

      bcrypt.hash(password, user.salt, function(err, hash) {
	if (err)
	  return done(err);

	if (hash == user.hash)
	  return done(null, user);

	done(null, false, { message: 'Incorrect password.' });
      });

    });
  }
));

passport.serializeUser(function(user, done) {
  console.log('serializeUser');
  done(null, user.id);
});

passport.deserializeUser(function(id, done) {
  console.log('deserializeUser');
  Users.findById(id, function(err, user) { done(err, user); });
});

// ========== App: the audio recorder ==========
app.get('/', function (req, res) {
  if (!req.isAuthenticated())
    return res.redirect('/login');

  req.method = 'get';
  res.cookie('userid', req.user.id, { maxAge: 1000 * 86400 * 7 /* milliseconds */});
  res.render('../view/index.html');
});

app.get('/more', function (req, res) {

  fs.readFile('corpus/example_04.txt', 'utf8', function (err, data) {
    if (err) throw err;
    res.send(data);
  });

});

function getUserNameById(userid, callback) {
  Users.findById(userid, function (err, user) {
    if (err) throw err;
    callback(user.username);
  });
}

// ========== Wave ==========
app.post('/wav', function (req, res) {

  var base64data = req.body.data.replace(/^.*;base64,/g, "");
  var utterance_id = req.body.uid;
  var corpus_id = req.body.cid;
  var timestamp = req.body.timestamp;

  getUserNameById(req.body.userid, onFound);

  function onFound(username) {
    console.log('username: ' + username);
    console.log('utterance_id: ' + utterance_id);

    var folder = DATA_DIR + username + "/wav/";
    var filename = sprintf('%s-%s-%s.wav', corpus_id, utterance_id, timestamp);
    exec("mkdir -p " + folder, save_wave(folder + filename, base64data, done));
  }

  function save_wave(filename, data, callback) {
    return function () {
      fwrite64(filename, data, callback);
    };
  }

  function done() {
    res.end();
  }

});

var exec = function (cmd, callback) {
  console.log('Executing shell command : "%s"...', cmd);
  require('child_process').exec(cmd, callback);
}

function fwrite64(filename, base64data, callback) {
  fs.writeFile(filename, base64data, 'base64', function(err) {
    if (err) throw err;
    console.log("The file was saved as \"" + filename + "\"!");
    callback();
  }); 
}

app.get('/wav/:username', function (req, res) {
  // TODO
  var username = req.params.username;
  var folder = DATA_DIR + username + "/wav/";

  // var tmp_fn = "`ls " + folder + " | md5sum | cut -f 1 -d ' '`" + ".tar.gz";
  // var tmp_fn = new Date().getTime() + ".tar.gz";
  // var cmd = sprintf("tar zcvf %s %s/*", folder + tmp_fn, folder);
  var cmd = "ls " + folder + "/* | sed 's%^%wget %g' | sed 's%" + DATA_DIR + "%http://140.112.21.18/recorded_waves/%g' | sed 's%$%<br/>%g'";
  exec(cmd, function (err, data) {
    res.send(data);
    // res.send("abc\n123");
  });
  // show all wave files in some GUI form
});

app.get('/status', function (req, res) {
  // TODO
  res.send('good');
});

// ========== Login ========== 
app.post('/login', passport.authenticate('local', {
  successRedirect: '/',
  failureRedirect: '/login'
}));

app.get('/login', tryAutoLogin);

function tryAutoLogin(req, res, next) {
  Users.findById(req.cookies.userid, function(err, user) { 

    if (!user)
      return res.render('../view/login.html');
    else {
      req.logIn(user, function (err) {
	res.redirect('/');
      });
    }
  });
}

// ========== Log Out ========== 
app.get('/logout', function (req, res) {
  req.logout();
  res.clearCookie('userid');
  res.redirect('/');
});

// ========== Sign Up ========== 
app.post('/signup', function (req, res) {
  var username = req.body.username,
      fullname = req.body.fullname,
      password = req.body.password;

  console.log("fullname: " + fullname);

  Users.findOne({username : username}, function(err,user) {
    if (err)
      throw err;

    if (user)
      res.render('../view/signup.html', {message: "This username has already been used.  :("});
    else
      getHashAndSalt(password, onHashed);
  });
  

  function onHashed(hash, salt) {
    var user = new Users({
      username: username,
      fullname: fullname,
      salt: salt,
      hash: hash
    });

    console.log('hash: "' + hash + '"');
    console.log('salt: "' + salt + '"');

    user.save(onUserAdded);
  }

  function getHashAndSalt(passwd, callback) {
    bcrypt.genSalt(10, onSalted);

    function onSalted(err, salt) {
      bcrypt.hash(passwd, salt, function(err, hash) {
	if (err) throw err;
	callback(hash, salt);
      });
    }
  }

  function onUserAdded(err, that) {
    if (err) throw err;
    console.log('New user added.');
    res.redirect('/login');
  }
});

app.get('/signup', function (req, res) {
  res.render('../view/signup.html', {message: ""});
});

app.get('/upload', function (req, res) {
  res.render('../view/upload.html');
});

// ========== Basic Auth ========== 
app.get('/basicAuth', express.basicAuth('kevin', '12345678'), function (req, res) {
  res.end("Authorized!!");
});

app.listen(3001);
