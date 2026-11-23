const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const PORT = Number(process.env.PORT || 8000);
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const REQUEST_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const requestCounts = new Map();
let mcpClientPromise;
const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/script.js', ['script.js', 'text/javascript; charset=utf-8']],
  ['/chat.js', ['chat.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/Assets/Img/notebook.svg', ['Assets/Img/notebook.svg', 'image/svg+xml']],
  ['/Assets/Img/faleconosco.svg', ['Assets/Img/faleconosco.svg', 'image/svg+xml']]
]);

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(data));
}

function consumeRateLimit(request) {
  const now = Date.now();
  const clientIp = request.socket.remoteAddress || 'unknown';
  const current = requestCounts.get(clientIp);

  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    requestCounts.set(clientIp, { startedAt: now, count: 1 });
    return true;
  }

  current.count += 1;
  return current.count <= REQUEST_LIMIT;
}

async function readJsonBody(request, maxBytes = 4096) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > maxBytes) {
      throw new Error('Request body too large');
    }
  }
  return JSON.parse(body);
}

function getMcpClient() {
  if (!mcpClientPromise) {
    const client = new Client({
      name: 'buscador-assistencia-web',
      version: '1.0.0'
    });
    const proxyUrl = process.env.PLACES_PROXY_URL
      || `http://127.0.0.1:${PORT}/api/places/search`;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(__dirname, 'mcp-server.js')],
      cwd: __dirname,
      env: {
        ...process.env,
        PLACES_PROXY_URL: proxyUrl
      }
    });
    mcpClientPromise = client.connect(transport)
      .then(() => client)
      .catch((error) => {
        mcpClientPromise = undefined;
        throw error;
      });
  }

  return mcpClientPromise;
}

const GEMINI_TOOLS = [{
  functionDeclarations: [
    {
      name: 'traduzir_e_mapear_servico',
      description: 'Interpreta um relato leigo e sugere uma categoria de serviço técnico.',
      parameters: {
        type: 'OBJECT',
        properties: {
          relato: {
            type: 'STRING',
            description: 'Relato do problema em linguagem natural.'
          }
        },
        required: ['relato']
      }
    },
    {
      name: 'buscar_assistencias_google_places',
      description: 'Busca assistências técnicas por serviço em município e estado brasileiros.',
      parameters: {
        type: 'OBJECT',
        properties: {
          cidade: { type: 'STRING', description: 'Município brasileiro.' },
          estado: { type: 'STRING', description: 'UF ou nome do estado.' },
          servico: { type: 'STRING', description: 'Categoria de serviço técnico.' }
        },
        required: ['cidade', 'estado', 'servico']
      }
    }
  ]
}];

const CHAT_SYSTEM_INSTRUCTION = `Você é o assistente do Buscador de Assistência Técnica, fala português brasileiro e ajuda a entender problemas de computadores e encontrar assistências.
Responda dúvidas com clareza, sem afirmar um diagnóstico remoto como certeza. Para sintomas que possam indicar superaquecimento ou risco elétrico, recomende desligar o equipamento e procurar um técnico; não oriente abrir fontes de alimentação.
Quando a pessoa descrever um defeito, use traduzir_e_mapear_servico para identificar uma categoria provável. Se faltarem detalhes, faça perguntas antes de concluir.
Só procure lojas quando a pessoa quiser encontrá-las e informar cidade e estado. Nesse caso, use a categoria retornada pela ferramenta e chame buscar_assistencias_google_places. Não invente endereços, avaliações ou resultados; apresente somente os dados retornados pela ferramenta.
Se a busca não retornar lojas, informe isso e ofereça ajustar serviço ou localidade.`;

async function requestGemini(contents) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: CHAT_SYSTEM_INSTRUCTION }]
        },
        contents,
        tools: GEMINI_TOOLS,
        generationConfig: { temperature: 0.4, maxOutputTokens: 1200 }
      }),
      signal: AbortSignal.timeout(30_000)
    }
  );

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('O Gemini retornou uma resposta inválida.');
  }

  if (!response.ok) {
    const reason = data?.error?.message;
    throw new Error(reason
      ? `O Gemini recusou a solicitação: ${reason}`
      : `O Gemini respondeu com HTTP ${response.status}.`);
  }

  return data;
}

function parseToolResult(result) {
  const text = (result.content || [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');

  if (result.isError) {
    return { erro: text || 'A ferramenta MCP não conseguiu concluir a solicitação.' };
  }

  try {
    return JSON.parse(text);
  } catch {
    return { resultado: text };
  }
}

async function executeMcpTool(name, args) {
  const allowedTools = new Set([
    'traduzir_e_mapear_servico',
    'buscar_assistencias_google_places'
  ]);
  if (!allowedTools.has(name)) {
    throw new Error(`O Gemini solicitou uma ferramenta não permitida: ${name}`);
  }

  const client = await getMcpClient();
  const result = await client.callTool({ name, arguments: args });
  return parseToolResult(result);
}

async function runChat(messages) {
  const contents = [];
  for (const message of messages.slice(-20)) {
    if (contents.length === 0 && message.role === 'model') {
      continue;
    }

    const previousMessage = contents[contents.length - 1];
    if (previousMessage?.role === message.role) {
      previousMessage.parts[0].text += `\n${message.text}`;
    } else {
      contents.push({
        role: message.role,
        parts: [{ text: message.text }]
      });
    }
  }

  for (let round = 0; round < 5; round += 1) {
    const data = await requestGemini(contents);
    const parts = data.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
      throw new Error('O Gemini não retornou uma resposta para o chat.');
    }

    const functionCalls = parts.filter((part) => part.functionCall);
    if (functionCalls.length === 0) {
      const answer = parts
        .filter((part) => typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n')
        .trim();
      if (!answer) {
        throw new Error('O Gemini retornou uma resposta vazia.');
      }
      return answer;
    }

    contents.push({ role: 'model', parts });
    const functionResponses = [];
    for (const part of functionCalls) {
      const { name, args } = part.functionCall;
      const result = await executeMcpTool(name, args || {});
      functionResponses.push({
        functionResponse: {
          name,
          response: result,
          ...(part.functionCall.id ? { id: part.functionCall.id } : {})
        }
      });
    }
    contents.push({ role: 'user', parts: functionResponses });
  }

  throw new Error('O agente excedeu o limite de chamadas de ferramentas nesta mensagem.');
}

async function chat(request, response) {
  if (!consumeRateLimit(request)) {
    sendJson(response, 429, { error: 'Muitas mensagens em sequência. Aguarde um minuto e tente novamente.' });
    return;
  }

  if (!GEMINI_API_KEY) {
    sendJson(response, 503, { error: 'Configure GEMINI_API_KEY no arquivo .env para ativar o chat com IA.' });
    return;
  }

  if (!request.headers['content-type']?.includes('application/json')) {
    sendJson(response, 415, { error: 'O formato da solicitação deve ser JSON.' });
    return;
  }

  let messages;
  try {
    const body = await readJsonBody(request, 24_000);
    messages = body.messages;
  } catch {
    sendJson(response, 400, { error: 'A solicitação está vazia, muito grande ou contém JSON inválido.' });
    return;
  }

  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
    sendJson(response, 400, { error: 'Envie entre 1 e 20 mensagens para continuar a conversa.' });
    return;
  }

  const validMessages = messages.every((message) =>
    message
    && (message.role === 'user' || message.role === 'model')
    && typeof message.text === 'string'
    && message.text.trim().length > 0
    && message.text.length <= 2000
  );
  if (!validMessages || messages[messages.length - 1].role !== 'user') {
    sendJson(response, 400, { error: 'As mensagens da conversa são inválidas.' });
    return;
  }

  try {
    const answer = await runChat(messages);
    sendJson(response, 200, { answer });
  } catch (error) {
    console.error('Falha no chat com o agente:', error.message);
    sendJson(response, 502, { error: error.message || 'O agente não conseguiu responder. Tente novamente.' });
  }
}

async function searchPlaces(request, response) {
  if (!consumeRateLimit(request)) {
    sendJson(response, 429, { error: 'Muitas buscas em sequência. Aguarde um minuto e tente novamente.' });
    return;
  }

  if (!GOOGLE_MAPS_API_KEY) {
    sendJson(response, 503, { error: 'Configure GOOGLE_MAPS_API_KEY no arquivo .env do servidor.' });
    return;
  }

  if (!request.headers['content-type']?.includes('application/json')) {
    sendJson(response, 415, { error: 'O formato da solicitação deve ser JSON.' });
    return;
  }

  let location;
  let service;
  try {
    const body = await readJsonBody(request);
    location = typeof body.location === 'string' ? body.location.trim() : '';
    service = typeof body.service === 'string' ? body.service.trim() : '';
  } catch {
    sendJson(response, 400, { error: 'A solicitação está vazia ou contém JSON inválido.' });
    return;
  }

  if (!location || location.length > 150) {
    sendJson(response, 400, { error: 'Informe um bairro ou cidade (até 150 caracteres).' });
    return;
  }

  if (service.length > 120) {
    sendJson(response, 400, { error: 'O serviço informado deve ter até 120 caracteres.' });
    return;
  }

  try {
    const googleResponse = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating'
      },
      body: JSON.stringify({
        textQuery: `${service || 'assistência técnica de computadores'} em ${location}, Brasil`,
        languageCode: 'pt-BR',
        regionCode: 'BR',
        maxResultCount: 6
      }),
      signal: AbortSignal.timeout(10_000)
    });

    if (!googleResponse.ok) {
      console.error(`Google Places API respondeu com HTTP ${googleResponse.status}.`);
      sendJson(response, 502, { error: 'O Google Places recusou a busca. Confira a chave, o faturamento e a Places API (New) no Google Cloud.' });
      return;
    }

    const data = await googleResponse.json();
    const places = (data.places || []).map((place) => ({
      name: place.displayName?.text || 'Assistência técnica',
      address: place.formattedAddress || 'Endereço não informado',
      rating: place.rating || null
    }));

    sendJson(response, 200, { places });
  } catch (error) {
    console.error('Falha ao consultar o Google Places:', error.message);
    sendJson(response, 502, { error: 'Não foi possível conectar ao Google Places. Tente novamente.' });
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (requestUrl.pathname === '/api/places/search') {
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' });
      response.end();
      return;
    }
    await searchPlaces(request, response);
    return;
  }

  if (requestUrl.pathname === '/api/chat') {
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' });
      response.end();
      return;
    }
    await chat(request, response);
    return;
  }

  if (requestUrl.pathname === '/api/chat/status') {
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' });
      response.end();
      return;
    }
    sendJson(response, 200, { enabled: Boolean(GEMINI_API_KEY) });
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  const publicFile = publicFiles.get(requestUrl.pathname);
  if (!publicFile) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  try {
    const filePath = path.join(__dirname, publicFile[0]);
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': publicFile[1],
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error('Falha ao servir arquivo:', error.message);
    response.writeHead(500);
    response.end('Internal server error');
  }
});

server.listen(PORT, () => {
  console.log(`Buscador disponível em http://localhost:${PORT}`);
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('GOOGLE_MAPS_API_KEY não está configurada; buscas reais estão desativadas.');
  }
});
