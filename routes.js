// This file is required by app.js. It sets up event listeners
// for the two main URL endpoints of the application - /create and /chat/:id
// and listens for socket.io messages.

// Use the gravatar module, to turn email addresses into avatar images:

var gravatar = require('gravatar');
var url = require('url');
var request = require('request');
var supportEmail = '<supportEmail>';
var urlForOutbound = 'http://sandbox.ask-fast.com/question/open?message=';
var answerCallback = 'http://<hostName>/chat/reply';
var accountId = '';
var refreshToken = '';

// Export a function, so that we can pass 
// the app and io instances from the app.js file:

var socketForReply = "";

module.exports = function(app,io){

	app.get('/', function(req, res){

		// Render views/home.html
		res.render('home');
	});

	app.get('/create', function(req,res){

		// Generate unique id for the room
		var id = Math.round((Math.random() * 1000000));

		// Redirect to the random room
		res.redirect('/chat/'+id);
	});

	app.get('/chat/:id', function(req,res){

		// Render the chant.html view
		res.render('chat');
	});


    // post handler for parsing the email reply
    // EG: /chat/reply?roomId=<value>
	app.post('/chat/reply', function(req,res){

		// fetch the body (reply) from the answerPost
        var body = '';
        req.on('data', function(data) { body += data; });
        req.on('end', function () {
            // assume ask-fast dialog-object in body
            var reply = JSON.parse(body);

            var msg = reply.answer_text;
            var user = "Shravan";
		    var img = "https://askcs.zendesk.com/system/photos/9899/5472/ASKlogo2014_1.png";
		    //fetch the roomId from the answerPost request url
		    var roomId = url.parse(req.url, true).query.roomId;

if( !roomId )console.log("todo: cancel this operation");

            //fetch all clients from that room
            console.log("search in ", io.sockets.sockets.length, " sockets for room ", roomId );
            for( var i=0 ; i < io.sockets.sockets.length; i++ )
            {
                var client = io.sockets.sockets[i];

console.log(  "search deeper " , client.rooms );
if( !client.rooms )console.log('what?', client );

                for( var j=0; j<client.rooms.length; j++ )
                {
                    if( client.rooms[j] == roomId )
                    {
                        console.log("match! try hook send ",msg," to ", roomId );
                        client.broadcast.to(roomId).emit('receive', {msg: msg, user: user, img: img});  // <-- this does not work
                        break;
                    }
                }
            }
/*
		var room = findClientsSocket(io, roomId);
		socketForReply.broadcast.to(room).emit('receive', {msg: msg, user: user, img: img});
*/
            //what are these?
            res.render('chat');
            req.connection.destroy();
        });

	});

	// Initialize a new socket.io application, named 'chat'
	var chat = io.on('connection', function (socket) {

		socketForReply = socket;

		// When the client emits the 'load' event, reply with the 
		// number of people in this chat room

		socket.on('load',function(data){

			var room = findClientsSocket(io,data);
			if(room.length === 0 ) {

				socket.emit('peopleinchat', {number: 0});
			}
			else if(room.length === 1) {

				socket.emit('peopleinchat', {
					number: 1,
					user: room[0].username,
					avatar: room[0].avatar,
					id: data
				});
			}
			else if(room.length >= 2) {

				chat.emit('tooMany', {boolean: true});
			}
		});

		// When the client emits 'login', save his name and avatar,
		// and add them to the room
		socket.on('login', function(data) {

			var room = findClientsSocket(io, data.id);
			// Only two people per room are allowed
			if (room.length < 2) {

				// Use the socket object to store data. Each client gets
				// their own unique socket object

				socket.username = data.user;
				socket.room = data.id;
				socket.avatar = gravatar.url(data.avatar, {s: '140', r: 'x', d: 'mm'});

				// Tell the person what he should use for an avatar
				socket.emit('img', socket.avatar);


				// Add the client to the room
				socket.join(data.id);

				if (room.length == 1) {

					var usernames = [],
						avatars = [];

					usernames.push(room[0].username);
					usernames.push(socket.username);

					avatars.push(room[0].avatar);
					avatars.push(socket.avatar);

					// Send the startChat event to all the people in the
					// room, along with a list of people that are in it.

					chat.in(data.id).emit('startChat', {
						boolean: true,
						id: data.id,
						users: usernames,
						avatars: avatars
					});
				}
			}
			else {
				socket.emit('tooMany', {boolean: true});
			}
		});

		// Somebody left the chat
		socket.on('disconnect', function() {

			// Notify the other person in the chat room
			// that his partner has left

			socket.broadcast.to(this.room).emit('leave', {
				boolean: true,
				room: this.room,
				user: this.username,
				avatar: this.avatar
			});

			// leave the room
			socket.leave(socket.room);
		});


		// Handle the sending of messages
		socket.on('msg', function(data){

			// When the server receives a message, it sends it to the other person in the room.
			// socket.broadcast.to(socket.room).emit('receive', {msg: data.msg, user: data.user, img: data.img});
			msg = encodeURI(data.msg);
			console.log(socket.room);
			//perform the outbound email using ASK-Fast
			//fetch askfast keys
			request.post('http://sandbox.ask-fast.com/keyserver/token', {form: {'client_id' : accountId, 'grant_type': 'refresh_token', 'refresh_token' : refreshToken, 'client_secret': 'none' }}, 
				function(err, httpResponse,body){
					var response = JSON.parse(body);
					console.log('accessToken: ' + response.access_token);
					answerCallback += '?roomId=' + socket.room + '&clientName=' + data.user;
					urlForOutbound += msg + '&answerCallback=' + answerCallback;
					console.log('email to be sent: '+ msg + ' from: ' + data.user + ' using url: '+ urlForOutbound);
					var postData = {'adapterType' : 'EMAIL', 'address': supportEmail, 'url': urlForOutbound};
					var url = 'https://sandbox.ask-fast.com/startDialog';
					var options = {
					  method: 'post',
					  body: postData,
					  headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + response.access_token},
					  json: true,
					  url: url
					};
					//send outbound request
					request(options, function (err, res, body) {
						if (err) {
							inspect(err, 'error posting json')
							return;
						}
						console.log('response of outbound call: ' + body);
					});
				});
		});
	});
};

function findClientsSocket(io,roomId, namespace) {
	var res = [],
		ns = io.of(namespace ||"/");    // the default namespace is "/"

	if (ns) {
		for (var id in ns.connected) {
			if(roomId) {
				var index = ns.connected[id].rooms.indexOf(roomId) ;
				if(index !== -1) {
					res.push(ns.connected[id]);
				}
			}
			else {
				res.push(ns.connected[id]);
			}
		}
	}
	return res;
}


