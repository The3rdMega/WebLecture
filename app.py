from flask import Flask, render_template, request, redirect, url_for, session
from flask_socketio import SocketIO, send, emit, join_room, leave_room
import uuid

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your_very_secret_key_here!'
socketio = SocketIO(app, cors_allowed_origins="*")

rooms = {}
user_to_room_map = {}

def generate_room_code():
    return uuid.uuid4().hex[:6].upper()

def get_room_members(room_code):
    if room_code in rooms and 'users' in rooms[room_code]:
        return [{'sid': sid, 'nickname': nick} for sid, nick in rooms[room_code]['users'].items()]
    return []

def _close_room_and_kick_users(room_code_to_close, admin_nickname_who_left):
    if room_code_to_close not in rooms:
        print(f"Tentativa de fechar sala {room_code_to_close}, mas ela não existe mais.")
        return

    print(f"Admin {admin_nickname_who_left} saiu. Fechando sala {room_code_to_close} para todos os usuários restantes.")
    
    if 'users' not in rooms[room_code_to_close]:
        print(f"AVISO: Sala {room_code_to_close} não tem lista de usuários ao tentar fechar.")
        del rooms[room_code_to_close]
        return

    users_to_kick_sids = list(rooms[room_code_to_close]['users'].keys())

    for user_sid in users_to_kick_sids:
        user_nickname_in_room = rooms[room_code_to_close]['users'].get(user_sid, "Usuário")
        print(f"  Enviando force_disconnect e removendo {user_nickname_in_room} (SID: {user_sid}) da sala {room_code_to_close}.")
        
        emit('force_disconnect', {
            'message': f'O administrador "{admin_nickname_who_left}" saiu e a sala foi fechada.'
        }, to=user_sid)
        
        leave_room(room_code_to_close, sid=user_sid)
        user_to_room_map.pop(user_sid, None)

    if room_code_to_close in rooms:
        del rooms[room_code_to_close]
        print(f"Sala {room_code_to_close} deletada.")
    else:
        print(f"Sala {room_code_to_close} foi deletada concorrentemente antes da limpeza final.")


@app.route('/')
def lobby():
    return render_template('lobby.html')

@app.route('/room/<room_code>')
def room_view(room_code):
    return render_template('index.html', room_code=room_code)


@socketio.on('connect')
def handle_connect():
    print(f'Cliente conectado: {request.sid}')

@socketio.on('disconnect')
def handle_disconnect():
    disconnected_sid = request.sid
    print(f'Cliente desconectado: {disconnected_sid}')
    room_code = user_to_room_map.pop(disconnected_sid, None)

    if room_code and room_code in rooms:
        admin_sid_of_room = rooms[room_code].get('admin_sid')
        
        disconnected_nickname = rooms[room_code]['users'].pop(disconnected_sid, None)

        if disconnected_nickname is None:
            if room_code not in rooms:
                 print(f"Sala {room_code} não existe mais. Desconexão de {disconnected_sid} (provavelmente já expulso).")
            else:
                 print(f"AVISO: {disconnected_sid} estava em user_to_room_map para {room_code} mas não na lista de usuários da sala no momento da desconexão.")
            return

        if disconnected_sid == admin_sid_of_room:
            print(f"Admin {disconnected_nickname} (SID: {disconnected_sid}) desconectou da sala {room_code}.")
            _close_room_and_kick_users(room_code, disconnected_nickname)
        else:
            if room_code in rooms:
                print(f"Usuário {disconnected_nickname} (SID: {disconnected_sid}) desconectou da sala {room_code}.")
                emit('user_left', {'nickname': disconnected_nickname, 'sid': disconnected_sid}, to=room_code)
                emit('user_list_update', get_room_members(room_code), to=room_code)
                
                if not rooms[room_code]['users']:
                    print(f"Sala {room_code} está vazia após saída de {disconnected_nickname}. Removendo.")
                    del rooms[room_code]
            else:
                print(f"Sala {room_code} não existe mais (provavelmente fechada pelo admin). Desconexão de {disconnected_nickname} finalizada.")


@socketio.on('create_room')
def handle_create_room(data):
    nickname = data.get('nickname')
    if not nickname:
        emit('error', {'message': 'Nickname é obrigatório.'})
        return

    room_code = generate_room_code()
    while room_code in rooms:
        room_code = generate_room_code()
    
    rooms[room_code] = {
        'admin_sid': None, 
        'admin_nickname': nickname,
        'users': {}, 
        'draw_history': []
    }
    print(f"'{nickname}' solicitou a criação da sala: {room_code} (admin a ser confirmado no join)")
    emit('room_created', {'room_code': room_code, 'admin_nickname': nickname, 'is_admin': True})


@socketio.on('join_room_request')
def handle_join_room_request(data):
    nickname = data.get('nickname')
    room_code = data.get('room_code')
    i_should_be_admin = data.get('i_should_be_admin', False)

    if not nickname or not room_code:
        emit('error', {'message': 'Nickname e código da sala são obrigatórios para entrar.'})
        return

    if room_code not in rooms:
        emit('join_error', {'message': f'Sala {room_code} não encontrada.'})
        return

    if request.sid in rooms[room_code]['users']: 
        emit('join_success', {
            'room_code': room_code,
            'admin_nickname': rooms[room_code]['admin_nickname'],
            'is_admin': rooms[room_code].get('admin_sid') == request.sid,
            'users': get_room_members(room_code),
            'draw_history': rooms[room_code]['draw_history']
        })
        return

    is_now_admin = False
    if i_should_be_admin and rooms[room_code]['admin_nickname'] == nickname:
        if rooms[room_code].get('admin_sid') is None or rooms[room_code]['admin_nickname'] == nickname:
             rooms[room_code]['admin_sid'] = request.sid
             is_now_admin = True
             print(f"'{nickname}' (SID: {request.sid}) confirmado como admin da sala {room_code}.")

    rooms[room_code]['users'][request.sid] = nickname
    user_to_room_map[request.sid] = room_code
    join_room(room_code)

    print(f"'{nickname}' (SID: {request.sid}) entrou na sala: {room_code}")
    emit('join_success', {
        'room_code': room_code,
        'admin_nickname': rooms[room_code]['admin_nickname'],
        'is_admin': is_now_admin,
        'users': get_room_members(room_code),
        'draw_history': rooms[room_code]['draw_history']
    })
    emit('user_joined', {'nickname': nickname, 'sid': request.sid}, to=room_code, include_self=False)
    emit('user_list_update', get_room_members(room_code), to=room_code, include_self=False)


@socketio.on('leave_room_request')
def handle_leave_room():
    leaving_sid = request.sid
    room_code = user_to_room_map.get(leaving_sid)

    if not room_code:
        emit('left_room_success')
        return

    if room_code not in rooms:
        user_to_room_map.pop(leaving_sid, None)
        emit('left_room_success')
        print(f"Usuário {leaving_sid} tentou sair da sala {room_code}, mas a sala não existe mais.")
        return

    admin_sid_of_room = rooms[room_code].get('admin_sid')
    leaving_nickname = rooms[room_code]['users'].get(leaving_sid)

    if not leaving_nickname:
        user_to_room_map.pop(leaving_sid, None)
        leave_room(room_code, sid=leaving_sid)
        emit('left_room_success')
        print(f"AVISO: Usuário {leaving_sid} mapeado para sala {room_code}, mas não encontrado na lista de usuários da sala.")
        return

    user_to_room_map.pop(leaving_sid, None)
    leave_room(room_code, sid=leaving_sid)
    
    if leaving_sid in rooms[room_code]['users']:
        del rooms[room_code]['users'][leaving_sid]

    if leaving_sid == admin_sid_of_room:
        print(f"Admin {leaving_nickname} (SID: {leaving_sid}) solicitou sair da sala {room_code}.")
        _close_room_and_kick_users(room_code, leaving_nickname)
    else:
        if room_code in rooms:
            print(f"Usuário {leaving_nickname} (SID: {leaving_sid}) saiu da sala {room_code}.")
            emit('user_left', {'nickname': leaving_nickname, 'sid': leaving_sid}, to=room_code)
            emit('user_list_update', get_room_members(room_code), to=room_code)
            
            if not rooms[room_code]['users']:
                print(f"Sala {room_code} está vazia após saída de {leaving_nickname}. Removendo.")
                del rooms[room_code]
        else:
            print(f"Sala {room_code} não existe mais (provavelmente fechada pelo admin). Saída de {leaving_nickname} finalizada.")
            
    emit('left_room_success')


@socketio.on('kick_user_request')
def handle_kick_user(data):
    target_sid = data.get('target_sid')
    room_code = user_to_room_map.get(request.sid)

    if not room_code or room_code not in rooms:
        emit('error', {'message': 'Você não está em uma sala válida.'})
        return

    if rooms[room_code].get('admin_sid') != request.sid:
        emit('error', {'message': 'Você não é o administrador desta sala.'})
        return

    if target_sid not in rooms[room_code]['users']:
        emit('error', {'message': 'Usuário alvo não encontrado na sala.'})
        return
    
    if target_sid == request.sid:
        emit('error', {'message': 'Administrador não pode se expulsar.'})
        return

    admin_nickname_who_kicked = rooms[room_code]['users'].get(request.sid, "Admin")
    kicked_nickname = rooms[room_code]['users'].pop(target_sid, None)
    user_to_room_map.pop(target_sid, None)
    leave_room(room_code, sid=target_sid)

    if kicked_nickname:
        print(f"Admin {admin_nickname_who_kicked} expulsou {kicked_nickname} da sala {room_code}")
        emit('kicked', {'message': f'Você foi expulso da sala por {admin_nickname_who_kicked}.'}, to=target_sid)
        emit('user_left', {'nickname': kicked_nickname, 'sid': target_sid, 'kicked': True}, to=room_code)
        emit('user_list_update', get_room_members(room_code), to=room_code)


@socketio.on('chat_message')
def handle_chat_message(data):
    message = data['message']
    room_code = user_to_room_map.get(request.sid)
    current_nickname = None
    if room_code and room_code in rooms and request.sid in rooms[room_code]['users']:
        current_nickname = rooms[room_code]['users'][request.sid]

    if room_code and current_nickname:
        print(f"Mensagem na sala {room_code} de {current_nickname}: {message}")
        emit('message', {'nickname': current_nickname, 'message': message, 'sid': request.sid}, to=room_code)
    else:
        print(f"Mensagem não enviada: usuário {request.sid} não está em uma sala ou sem nickname registrado.")

@socketio.on('draw')
def handle_draw(data):
    room_code = user_to_room_map.get(request.sid)
    if room_code and room_code in rooms:
        rooms[room_code]['draw_history'].append(data)
        emit('draw', data, to=room_code, include_self=False)

@socketio.on('clear_canvas_request')
def handle_clear_canvas_request():
    room_code = user_to_room_map.get(request.sid)
    if room_code and room_code in rooms:
        rooms[room_code]['draw_history'].clear()
        emit('clear_canvas', to=room_code)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5555, debug=True)