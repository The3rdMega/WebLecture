document.addEventListener('DOMContentLoaded', () => {
    const socket = io(); 

    const nicknameInput = document.getElementById('nickname');
    const createRoomBtn = document.getElementById('createRoomBtn');
    const roomCodeInput = document.getElementById('roomCode');
    const joinRoomBtn = document.getElementById('joinRoomBtn');
    const errorMessageP = document.getElementById('error-message');

    const savedNickname = localStorage.getItem('webLectureNickname');
    if (savedNickname) {
        nicknameInput.value = savedNickname;
    }

    function displayError(message) {
        errorMessageP.textContent = message;
        setTimeout(() => { errorMessageP.textContent = ''; }, 5000);
    }

    createRoomBtn.addEventListener('click', () => {
        const nickname = nicknameInput.value.trim();
        if (!nickname) {
            displayError('Por favor, insira um nome de exibição.');
            return;
        }
        localStorage.setItem('webLectureNickname', nickname); 
        socket.emit('create_room', { nickname }); 
    });

    joinRoomBtn.addEventListener('click', () => {
        const nickname = nicknameInput.value.trim();
        const roomCode = roomCodeInput.value.trim().toUpperCase();
        if (!nickname) {
            displayError('Por favor, insira um nome de exibição.');
            return;
        }
        if (!roomCode) {
            displayError('Por favor, insira o código da sala.');
            return;
        }
        localStorage.setItem('webLectureNickname', nickname);

        sessionStorage.setItem('nickname', nickname);
        sessionStorage.setItem('isAdmin', 'false'); 
        sessionStorage.setItem('targetRoomCode', roomCode); 

        window.location.href = `/room/${roomCode}`;
    });

    socket.on('room_created', (data) => {
        console.log('Sala criada:', data);
        sessionStorage.setItem('nickname', nicknameInput.value.trim()); 
        sessionStorage.setItem('isAdmin', 'true'); 
        sessionStorage.setItem('targetRoomCode', data.room_code); 
        window.location.href = `/room/${data.room_code}`;
    });

    socket.on('error', (data) => { 
        displayError(data.message);
    });

    window.addEventListener('pageshow', function (event) {
        if (event.persisted || (window.performance && window.performance.navigation.type === 2)) {
            console.log("Lobby carregado do cache (botão voltar). Limpando sessionStorage relevante.");
            sessionStorage.removeItem('isAdmin');
            sessionStorage.removeItem('targetRoomCode');
        }
    });
});