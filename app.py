from flask import Flask, render_template, request
from flask_socketio import SocketIO, send, emit, join_room, leave_room

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

users = {}

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    print('Usuário conectado.')

@socketio.on('disconnect')
def handle_disconnect():
    for nickname, sid in users.items():
        if sid == request.sid:
            del users[nickname]
            send(f"{nickname} saiu do chat.", broadcast=True)
            break

@socketio.on('set_nickname')
def handle_nickname(nickname):
    users[nickname] = request.sid
    send(f"{nickname} entrou no chat!", broadcast=True)

@socketio.on('chat_message')
def handle_message(data):
    nickname = data['nickname']
    message = data['message']
    send(f"{nickname}: {message}", broadcast=True)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5555)
