document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');

  if (!form || !input) {
    return;
  }

  form.addEventListener('submit', enviarMensagem);
  input.addEventListener('keydown', function(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  fetch('/api/chat/status')
    .then((response) => {
      if (!response.ok) {
        throw new Error('Não foi possível verificar a configuração do chat.');
      }
      return response.json();
    })
    .then((data) => {
      if (!data.enabled) {
        document.getElementById('chatStatus').textContent =
          'Configure GEMINI_API_KEY no arquivo .env e reinicie o servidor para ativar o chat.';
      }
    })
    .catch((error) => {
      document.getElementById('chatStatus').textContent = error.message;
      console.error('Não foi possível verificar a configuração do chat.', error);
    });
});

const historicoChat = [];

async function enviarMensagem(event) {
  event.preventDefault();
  const input = document.getElementById('chatInput');
  const sendButton = document.getElementById('sendChatButton');
  const status = document.getElementById('chatStatus');
  const message = input.value.trim();

  if (!message || sendButton.disabled) {
    return;
  }

  historicoChat.push({ role: 'user', text: message });
  adicionarMensagemChat(message, 'user-message');
  input.value = '';
  sendButton.disabled = true;
  status.textContent = 'Assistente está pensando...';

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: historicoChat.slice(-20) })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Não foi possível obter uma resposta do assistente.');
    }

    historicoChat.push({ role: 'model', text: data.answer });
    adicionarMensagemChat(data.answer, 'assistant-message');
  } catch (error) {
    adicionarMensagemChat(error.message, 'assistant-message');
    console.error('A conversa com o assistente falhou.', error);
  } finally {
    status.textContent = '';
    sendButton.disabled = false;
    input.focus();
  }
}

function adicionarMensagemChat(text, className) {
  const messages = document.getElementById('chatMessages');
  const bubble = document.createElement('div');
  bubble.className = `chat-message ${className}`;
  bubble.textContent = text;
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
}
