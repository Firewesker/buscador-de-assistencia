document.addEventListener('DOMContentLoaded', function() {
  const btn = document.querySelector('.input-group button');
  if (btn) {
    btn.addEventListener('click', executarBusca);
  }
});

async function executarBusca() {
  const locationInput = document.getElementById('userLocation').value.trim();
  const loading = document.getElementById('loading');
  const resultsDiv = document.getElementById('results');
  const apiWarning = document.getElementById('apiWarning');

  if (!locationInput) {
    alert('Por favor, digite o seu bairro ou cidade!');
    return;
  }

  resultsDiv.style.display = 'none';
  resultsDiv.replaceChildren();
  apiWarning.style.display = 'none';
  loading.style.display = 'block';

  try {
    const response = await fetch('/api/places/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: locationInput })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Não foi possível consultar o Google Places.');
    }

    loading.style.display = 'none';
    if (!data.places.length) {
      renderizarMensagem(`Nenhuma assistência técnica encontrada para "${locationInput}".`);
      return;
    }

    renderizarLojas(data.places);
  } catch (error) {
    loading.style.display = 'none';
    apiWarning.textContent = error.message;
    apiWarning.style.display = 'block';
    console.error('A busca por assistências falhou.', error);
  }
}

function criarCard(nome, endereco, avaliacao) {
  const card = document.createElement('div');
  card.className = 'store-card';

  const header = document.createElement('div');
  header.className = 'store-header';

  const storeName = document.createElement('div');
  storeName.className = 'store-name';
  storeName.textContent = nome || 'Assistência técnica';

  const storeRating = document.createElement('div');
  storeRating.className = 'store-rating';
  storeRating.textContent = avaliacao ? `⭐ ${avaliacao}` : 'Sem avaliação';

  header.append(storeName, storeRating);
  card.appendChild(header);

  const storeAddress = document.createElement('div');
  storeAddress.className = 'store-address';
  storeAddress.textContent = endereco || 'Endereço não informado';
  card.appendChild(storeAddress);

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = 'Google Maps';
  card.appendChild(badge);

  return card;
}

function renderizarLojas(places) {
  const resultsDiv = document.getElementById('results');
  places.slice(0, 6).forEach(function(place) {
    resultsDiv.appendChild(criarCard(
      place.name,
      place.address,
      place.rating
    ));
  });
  resultsDiv.style.display = 'flex';
}

function renderizarMensagem(mensagem) {
  const resultsDiv = document.getElementById('results');
  resultsDiv.textContent = mensagem;
  resultsDiv.style.display = 'block';
}
