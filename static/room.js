document.addEventListener('DOMContentLoaded', () => {
    const socket = io(); 

    const currentRoomCodeFromURL = ROOM_CODE;

    let nickname = sessionStorage.getItem('nickname');
    let iShouldBeAdmin = sessionStorage.getItem('isAdmin') === 'true';

    const roomToJoin = currentRoomCodeFromURL;

    if (!nickname) {
        alert("Seu nome de usuário não foi encontrado na sessão. Redirecionando para o lobby.");
        sessionStorage.clear(); 
        window.location.href = "/";
        return;
    }

    sessionStorage.removeItem('targetRoomCode');


    console.log(`Página da sala ${roomToJoin}. Usuário: ${nickname}. Intenção de ser admin: ${iShouldBeAdmin}`);

    const chat = document.getElementById('chat');
    const messageInput = document.getElementById('message');
    const whiteboard = document.getElementById('whiteboard');
    const ctx = whiteboard.getContext('2d');
    const userListUl = document.getElementById('userList');
    const userCountSpan = document.getElementById('userCount');
    const adminInfoP = document.getElementById('adminInfo');
    const leaveRoomBtn = document.getElementById('leaveRoomBtn');

    let drawing = false;
    let tool = 'draw';
    let lastPos = null;
    let actualIsAdmin = false; 

    socket.on('connect', () => {
        console.log('Conectado ao servidor Socket.IO na página da sala.');
        socket.emit('join_room_request', {
            nickname,
            room_code: roomToJoin,
            i_should_be_admin: iShouldBeAdmin
        });
    });

    socket.on('disconnect', (reason) => {
        console.log('Desconectado do servidor:', reason);
        addSystemMessage(`Você foi desconectado: ${reason}.`, 'error');
        if (reason === 'io server disconnect') { 
            sessionStorage.clear();
            window.location.href = "/"; 
        }
    });

    socket.on('reconnect_attempt', () => {
        addSystemMessage('Tentando reconectar...');
    });

    socket.on('reconnect', () => {
        addSystemMessage('Reconectado! Tentando entrar na sala novamente...');
        socket.emit('join_room_request', {
            nickname,
            room_code: roomToJoin,
            i_should_be_admin: iShouldBeAdmin 
        });
    });

    socket.on('error', (data) => { 
        console.error('Erro do servidor na sala:', data.message);
        addSystemMessage(`Erro: ${data.message}`, 'error');
    });

    socket.on('join_success', (data) => {
        console.log('Sucesso ao entrar/reentrar na sala:', data);
        actualIsAdmin = data.is_admin; 
        sessionStorage.setItem('isAdmin', actualIsAdmin.toString()); 

        updateUserList(data.users);
        adminInfoP.textContent = `Admin: ${data.admin_nickname || 'Nenhum'}`;
        addSystemMessage(`Você entrou na sala ${data.room_code}.`, 'system');

        clearCanvasLocal(); 
        data.draw_history.forEach(action => {
            drawLine(action.from, action.to, action.erase, action.color, action.lineWidth);
        });
    });

    socket.on('join_error', (data) => {
        alert(`Erro ao entrar na sala: ${data.message}. Redirecionando para o lobby.`);
        sessionStorage.clear();
        window.location.href = "/";
    });

    socket.on('user_joined', (data) => {
        addSystemMessage(`${data.nickname} entrou na sala.`, 'system');
    });

    socket.on('user_left', (data) => {
        if (data.kicked) {
            addSystemMessage(`${data.nickname} foi expulso da sala.`, 'system');
        } else {
            addSystemMessage(`${data.nickname} saiu da sala.`, 'system');
        }
    });

    socket.on('user_list_update', (users) => {
        updateUserList(users);
    });

    socket.on('admin_left', (data) => {
        addSystemMessage(data.message, 'warning'); 
        adminInfoP.textContent = `Admin: Nenhum`; 
    });

    socket.on('kicked', (data) => {
        alert(data.message);
        socket.disconnect(); 
        sessionStorage.clear();
        window.location.href = "/";
    });

    socket.on('force_disconnect', (data) => { 
        alert(data.message);
        socket.disconnect();
        sessionStorage.clear();
        window.location.href = "/";
    });

    socket.on('message', (data) => {
        const div = document.createElement('div');
        div.classList.add('message');

        if (data.sid === socket.id) {
            div.classList.add('you');
            div.textContent = `Você: ${data.message}`;
        } else {
            div.classList.add('other');
            div.textContent = `${data.nickname}: ${data.message}`;
        }
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
    });

    function addSystemMessage(message, type = 'system') {
        const div = document.createElement('div');
        div.classList.add('message', type);
        div.textContent = message;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
    }

    window.sendMessage = function () {
        const message = messageInput.value.trim();
        if (message) {
            socket.emit('chat_message', { message });
            messageInput.value = '';
        }
    }

    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    function resizeCanvas() {
        const currentImageData = whiteboard.width > 0 && whiteboard.height > 0 ? ctx.getImageData(0, 0, whiteboard.width, whiteboard.height) : null;
        whiteboard.width = whiteboard.offsetWidth;
        whiteboard.height = whiteboard.offsetHeight;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, whiteboard.width, whiteboard.height);
        if (currentImageData) {
            ctx.putImageData(currentImageData, 0, 0);
        }
    }
    window.addEventListener('resize', resizeCanvas);

    whiteboard.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        drawing = true;
        lastPos = [e.offsetX, e.offsetY];
        const drawData = {
            from: lastPos,
            to: lastPos,
            erase: tool === 'erase',
            color: tool === 'erase' ? 'white' : 'black',
            lineWidth: tool === 'erase' ? 10 : 2
        };
        drawLine(drawData.from, drawData.to, drawData.erase, drawData.color, drawData.lineWidth);
        socket.emit('draw', drawData);
    });

    whiteboard.addEventListener('mouseup', () => { drawing = false; lastPos = null; });
    whiteboard.addEventListener('mouseleave', () => { drawing = false; lastPos = null; });

    whiteboard.addEventListener('mousemove', e => {
        if (!drawing || !lastPos) return;
        const currentPos = [e.offsetX, e.offsetY];
        const drawData = {
            from: lastPos,
            to: currentPos,
            erase: tool === 'erase',
            color: tool === 'erase' ? 'white' : 'black',
            lineWidth: tool === 'erase' ? 10 : 2
        };
        drawLine(drawData.from, drawData.to, drawData.erase, drawData.color, drawData.lineWidth);
        socket.emit('draw', drawData);
        lastPos = currentPos;
    });

    whiteboard.addEventListener('touchstart', e => {
        e.preventDefault(); 
        if (e.touches.length === 1) { 
            drawing = true;
            const rect = whiteboard.getBoundingClientRect();
            lastPos = [e.touches[0].clientX - rect.left, e.touches[0].clientY - rect.top];
            const drawData = {
                from: lastPos,
                to: lastPos,
                erase: tool === 'erase',
                color: tool === 'erase' ? 'white' : 'black',
                lineWidth: tool === 'erase' ? 10 : 2
            };
            drawLine(drawData.from, drawData.to, drawData.erase, drawData.color, drawData.lineWidth);
            socket.emit('draw', drawData);
        }
    }, { passive: false }); 

    whiteboard.addEventListener('touchend', e => {
        e.preventDefault();
        drawing = false;
        lastPos = null;
    }, { passive: false });

    whiteboard.addEventListener('touchmove', e => {
        e.preventDefault();
        if (!drawing || !lastPos || e.touches.length !== 1) return;
        const rect = whiteboard.getBoundingClientRect();
        const currentPos = [e.touches[0].clientX - rect.left, e.touches[0].clientY - rect.top];
        const drawData = {
            from: lastPos,
            to: currentPos,
            erase: tool === 'erase',
            color: tool === 'erase' ? 'white' : 'black',
            lineWidth: tool === 'erase' ? 10 : 2
        };
        drawLine(drawData.from, drawData.to, drawData.erase, drawData.color, drawData.lineWidth);
        socket.emit('draw', drawData);
        lastPos = currentPos;
    }, { passive: false });

    function drawLine(from, to, erase = false, color = 'black', lineWidth = 2) {
        ctx.strokeStyle = erase ? 'white' : color;
        ctx.lineWidth = erase ? 10 : lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(...from);
        ctx.lineTo(...to);
        ctx.stroke();
    }

    socket.on('draw', data => {
        drawLine(data.from, data.to, data.erase, data.color, data.lineWidth);
    });

    function clearCanvasLocal() {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, whiteboard.width, whiteboard.height);
    }

    socket.on('clear_canvas', () => {
        clearCanvasLocal();
        addSystemMessage("O quadro branco foi limpo.", 'system');
    });

    window.setTool = function (t) { tool = t; console.log("Ferramenta definida para:", tool); }
    window.clearWhiteboard = function () { socket.emit('clear_canvas_request'); }
    window.saveImage = function () {
        const dataURL = whiteboard.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `whiteboard_${roomToJoin}.png`;
        link.click();
    }

    leaveRoomBtn.addEventListener('click', () => {
        if (confirm("Tem certeza que deseja sair da sala?")) {
            socket.emit('leave_room_request');
        }
    });

    socket.on('left_room_success', () => {
        addSystemMessage("Você saiu da sala. Redirecionando para o lobby...", 'system');
        sessionStorage.removeItem('isAdmin');
        window.location.href = "/";
    });

    function updateUserList(usersData) { 
        userListUl.innerHTML = '';
        if (Array.isArray(usersData)) {
            usersData.forEach(user => {
                const li = document.createElement('li');
                li.textContent = user.nickname + (user.nickname === nickname ? ' (Você)' : '');
                li.dataset.sid = user.sid; 

                if (actualIsAdmin && user.nickname !== nickname) {
                    const kickBtn = document.createElement('button');
                    kickBtn.textContent = 'Expulsar';
                    kickBtn.classList.add('kick-btn');
                    kickBtn.onclick = () => {
                        if (confirm(`Tem certeza que quer expulsar ${user.nickname}?`)) {
                            socket.emit('kick_user_request', { target_sid: user.sid });
                        }
                    };
                    li.appendChild(kickBtn);
                }
                userListUl.appendChild(li);
            });
            userCountSpan.textContent = usersData.length;
        } else {
            userCountSpan.textContent = 0; 
        }
    }

    resizeCanvas(); 
});