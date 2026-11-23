const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const PLACES_PROXY_URL = process.env.PLACES_PROXY_URL
  || 'http://127.0.0.1:8000/api/places/search';

const STATES = new Map([
  ['AC', 'AC'], ['ACRE', 'AC'],
  ['AL', 'AL'], ['ALAGOAS', 'AL'],
  ['AP', 'AP'], ['AMAPA', 'AP'],
  ['AM', 'AM'], ['AMAZONAS', 'AM'],
  ['BA', 'BA'], ['BAHIA', 'BA'],
  ['CE', 'CE'], ['CEARA', 'CE'],
  ['DF', 'DF'], ['DISTRITO FEDERAL', 'DF'],
  ['ES', 'ES'], ['ESPIRITO SANTO', 'ES'],
  ['GO', 'GO'], ['GOIAS', 'GO'],
  ['MA', 'MA'], ['MARANHAO', 'MA'],
  ['MT', 'MT'], ['MATO GROSSO', 'MT'],
  ['MS', 'MS'], ['MATO GROSSO DO SUL', 'MS'],
  ['MG', 'MG'], ['MINAS GERAIS', 'MG'],
  ['PA', 'PA'], ['PARA', 'PA'],
  ['PB', 'PB'], ['PARAIBA', 'PB'],
  ['PR', 'PR'], ['PARANA', 'PR'],
  ['PE', 'PE'], ['PERNAMBUCO', 'PE'],
  ['PI', 'PI'], ['PIAUI', 'PI'],
  ['RJ', 'RJ'], ['RIO DE JANEIRO', 'RJ'],
  ['RN', 'RN'], ['RIO GRANDE DO NORTE', 'RN'],
  ['RS', 'RS'], ['RIO GRANDE DO SUL', 'RS'],
  ['RO', 'RO'], ['RONDONIA', 'RO'],
  ['RR', 'RR'], ['RORAIMA', 'RR'],
  ['SC', 'SC'], ['SANTA CATARINA', 'SC'],
  ['SP', 'SP'], ['SAO PAULO', 'SP'],
  ['SE', 'SE'], ['SERGIPE', 'SE'],
  ['TO', 'TO'], ['TOCANTINS', 'TO']
]);

const SERVICE_CATALOG = [
  {
    service: 'recuperação de dados de HD ou SSD',
    patterns: [/\brecuper\w*\b.*\b(dado|arquivo|hd|ssd|disco)\b/, /\b(dado|arquivo)\b.*\b(hd|ssd|disco)\b/]
  },
  {
    service: 'remoção de vírus e malware',
    patterns: [/\bvirus\b/, /\bmalware\b/, /\b(programa|anuncio)\s+indesejad\w*\b/]
  },
  {
    service: 'formatação e reinstalação do sistema operacional',
    patterns: [/\bformat\w*\b/, /\breinstal\w*\b/, /\binstal\w*\b.*\b(windows|linux|sistema)\b/]
  },
  {
    service: 'troca de pasta térmica',
    patterns: [/\bpasta termica\b/]
  },
  {
    service: 'limpeza interna e manutenção do sistema de refrigeração',
    patterns: [/\b(barulho|ruido|ventoinha|cooler|superaquec\w*|esquent\w*|quent\w*)\b/, /\b(deslig\w*|desliga)\b.*\bsozinh\w*\b/]
  },
  {
    service: 'reparo ou troca de tela de notebook',
    patterns: [/\b(tela|display|monitor)\b.*\b(quebrad\w*|trincad\w*|apag\w*|defeit\w*)\b/, /\b(quebrad\w*|trincad\w*)\b.*\b(tela|display)\b/]
  },
  {
    service: 'reparo de teclado',
    patterns: [/\bteclado\b.*\b(defeit\w*|nao funciona|falh\w*|troca)\b/, /\bteclas?\b.*\b(nao funciona|parou)\b/]
  },
  {
    service: 'troca de bateria de notebook',
    patterns: [/\bbateria\b.*\b(defeit\w*|nao segura|nao carrega|troca|viciad\w*)\b/]
  },
  {
    service: 'reparo de conector de energia ou carregamento',
    patterns: [/\b(conector|entrada|porta)\b.*\b(energia|carregador|carga)\b/, /\bnao carrega\b/]
  },
  {
    service: 'reparo de placa-mãe',
    patterns: [/\bplaca mae\b/, /\bplaca principal\b/]
  },
  {
    service: 'reparo de fonte de alimentação',
    patterns: [/\bfonte\b.*\b(queimad\w*|defeit\w*|computador|pc)\b/, /\bpc\b.*\bnao liga\b/]
  },
  {
    service: 'instalação ou upgrade de memória RAM',
    patterns: [/\b(memoria ram|upgrade de memoria|aumentar memoria)\b/]
  },
  {
    service: 'instalação ou upgrade para SSD',
    patterns: [/\b(instal\w*|upgrade|troca|colocar)\b.*\bssd\b/, /\bhd\b.*\bssd\b/]
  },
  {
    service: 'diagnóstico de lentidão e otimização do computador',
    patterns: [/\blent\w*\b/, /\btrav\w*\b/, /\bdemor\w*\b.*\b(iniciar|ligar|abrir)\b/]
  },
  {
    service: 'reparo de impressora',
    patterns: [/\bimpressor\w*\b/]
  },
  {
    service: 'configuração de rede Wi-Fi',
    patterns: [/\b(wifi|wi-fi|internet|rede)\b.*\b(nao funciona|cai|configur\w*|conectar)\b/]
  }
];

function normalizeText(text) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function mapService(report) {
  const normalizedReport = normalizeText(report);
  const match = SERVICE_CATALOG.find((item) =>
    item.patterns.some((pattern) => pattern.test(normalizedReport))
  );

  if (!match) {
    return {
      servico: null,
      confianca: 'baixa',
      precisa_esclarecimento: true,
      catalogo_sugerido: SERVICE_CATALOG.map((item) => item.service)
    };
  }

  return {
    servico: match.service,
    confianca: 'media',
    precisa_esclarecimento: false,
    observacao: 'Categoria provável; a assistência deve confirmar a causa após diagnóstico.'
  };
}

function normalizeState(state) {
  const key = normalizeText(state).toUpperCase();
  return STATES.get(key);
}

function textResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
  };
}

const server = new McpServer({
  name: 'buscador-assistencia-tecnica',
  version: '1.0.0'
});

server.registerTool(
  'traduzir_e_mapear_servico',
  {
    title: 'Mapear serviço de informática',
    description: 'Interpreta um relato leigo e sugere a categoria de assistência técnica mais provável. Se não houver correspondência clara, peça detalhes ao usuário em vez de inventar um serviço.',
    inputSchema: {
      relato: z.string().trim().min(3).max(500).describe('Relato do problema em linguagem natural.')
    }
  },
  async ({ relato }) => textResult(mapService(relato))
);

server.registerTool(
  'buscar_assistencias_google_places',
  {
    title: 'Buscar assistências no Google Places',
    description: 'Busca assistências técnicas para um serviço em qualquer município do Brasil. Informe a cidade e a UF (ou nome do estado) separadamente e use a categoria retornada por traduzir_e_mapear_servico.',
    inputSchema: {
      cidade: z.string().trim().min(2).max(100).describe('Município brasileiro, por exemplo Duque de Caxias.'),
      estado: z.string().trim().min(2).max(30).describe('UF, por exemplo RJ, ou nome do estado.'),
      servico: z.string().trim().min(2).max(120).describe('Categoria de serviço, por exemplo recuperação de dados de HD ou SSD.')
    }
  },
  async ({ cidade, estado, servico }) => {
    const uf = normalizeState(estado);
    if (!uf) {
      return {
        ...textResult({
          erro: 'Estado brasileiro não reconhecido. Informe uma UF válida ou o nome completo do estado.'
        }),
        isError: true
      };
    }

    const response = await fetch(PLACES_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: `${cidade}, ${uf}`,
        service: servico
      }),
      signal: AbortSignal.timeout(12_000)
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('O proxy Places retornou uma resposta JSON inválida.');
    }

    if (!response.ok) {
      throw new Error(data?.error || `O proxy Places respondeu com HTTP ${response.status}.`);
    }

    if (!Array.isArray(data?.places)) {
      throw new Error('O proxy Places não retornou a lista de assistências esperada.');
    }

    return textResult({
      cidade,
      estado: uf,
      servico,
      assistencias: data.places
    });
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Falha ao iniciar o servidor MCP:', error);
  process.exitCode = 1;
});
