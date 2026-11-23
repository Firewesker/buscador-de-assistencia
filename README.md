# Buscador de Assistência Técnica

## Executar

1. Copie `.env.example` para `.env` e preencha `GOOGLE_MAPS_API_KEY` com uma chave restrita à Places API (New).
2. Preencha `GEMINI_API_KEY` com uma chave do Google AI Studio para habilitar o chat.
3. Instale as dependências com `npm install`.
4. Inicie o proxy HTTP e a interface com `npm start`.
5. Configure o cliente MCP para executar `npm run mcp` na pasta do projeto.

O chat web usa o Gemini para responder dúvidas e, quando apropriado, chama as
ferramentas do servidor MCP existente para mapear sintomas e buscar assistências.
A chave do Gemini permanece no backend e não é enviada ao navegador.

O servidor MCP usa transporte `stdio` e chama o proxy existente em
`http://127.0.0.1:8000/api/places/search`. Para outro endereço, defina
`PLACES_PROXY_URL` no ambiente do processo MCP. O processo MCP e o proxy HTTP
precisam estar ativos ao mesmo tempo.

## Ferramentas MCP

- `traduzir_e_mapear_servico`: recebe `relato` e sugere uma categoria de uma
  lista local de serviços. A categorização é baseada em regras e não substitui
  um diagnóstico técnico. Se não reconhecer o relato, retorna o catálogo para
  que o assistente peça mais detalhes ao usuário.
- `buscar_assistencias_google_places`: recebe `cidade`, `estado` (UF ou nome
  completo) e `servico`, normaliza o estado para a sigla oficial e encaminha
  `cidade, UF` ao proxy. A consulta inclui o Brasil e o serviço escolhido.

O proxy mantém o campo `location` aceito anteriormente pela interface e aceita
opcionalmente `service`; assim, buscas já existentes continuam funcionando.
Por padrão, a busca nacional usa português (`pt-BR`) e `regionCode: BR`.

## Configuração no VS Code

O arquivo .vscode/mcp.json é responsável por registrar o servidor no workspace atual. Com o proxy rodando via npm start, ative o servidor MCP diretamente pelo painel de controle do VS Code. Para conectar outros clientes MCP, configure o comando npm run mcp, definindo a raiz do projeto como o diretório de trabalho (working directory).