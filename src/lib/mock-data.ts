// Dados de seed/desenvolvimento. Não importe em telas de produção.
if (import.meta.env.PROD) {
  throw new Error("src/lib/mock-data.ts é permitido apenas para seed/dev, não para produção.");
}

export const faturamentoMensal = [
  { mes: "Jan", faturamento: 42500, lucro: 12100 },
  { mes: "Fev", faturamento: 51200, lucro: 15800 },
  { mes: "Mar", faturamento: 47800, lucro: 13200 },
  { mes: "Abr", faturamento: 58900, lucro: 18400 },
  { mes: "Mai", faturamento: 62400, lucro: 19900 },
  { mes: "Jun", faturamento: 55700, lucro: 16100 },
  { mes: "Jul", faturamento: 71200, lucro: 23800 },
  { mes: "Ago", faturamento: 68900, lucro: 22400 },
  { mes: "Set", faturamento: 74500, lucro: 25200 },
  { mes: "Out", faturamento: 82300, lucro: 28900 },
  { mes: "Nov", faturamento: 89100, lucro: 31400 },
  { mes: "Dez", faturamento: 95400, lucro: 34800 },
];

export const lucroPrevistoRealMensal = [
  { mes: "Jul", previsto: 25000, real: 23800 },
  { mes: "Ago", previsto: 24500, real: 22400 },
  { mes: "Set", previsto: 26800, real: 25200 },
  { mes: "Out", previsto: 30100, real: 28900 },
  { mes: "Nov", previsto: 32500, real: 31400 },
  { mes: "Dez", previsto: 35000, real: 34800 },
];

export const osPorStatus = [
  { name: "Em produção", value: 18, color: "#3b82f6" },
  { name: "Aguardando arte", value: 9, color: "#f59e0b" },
  { name: "Aguardando pagto", value: 6, color: "#eab308" },
  { name: "Pronto", value: 11, color: "#10b981" },
  { name: "Atrasado", value: 4, color: "#ef4444" },
  { name: "Instalação", value: 5, color: "#8b5cf6" },
];

export const produtosMaisVendidos = [
  { produto: "Adesivo vinil", qtd: 142 },
  { produto: "Banner lona", qtd: 98 },
  { produto: "Placa ACM", qtd: 67 },
  { produto: "Fachada LED", qtd: 41 },
  { produto: "Impressão 3D", qtd: 38 },
  { produto: "Corte CNC", qtd: 29 },
];

export const producaoPorMaquina = [
  { maquina: "Plotter i1600", horas: 184 },
  { maquina: "CNC 10060", horas: 96 },
  { maquina: "Bambu Lab 3D", horas: 142 },
  { maquina: "Plotter recorte", horas: 78 },
  { maquina: "Corte UV", horas: 54 },
];

export const tempoMedioPorEtapa = [
  { etapa: "Briefing", horas: 2 },
  { etapa: "Orçamento", horas: 4 },
  { etapa: "Design", horas: 8 },
  { etapa: "Aprovação", horas: 12 },
  { etapa: "Produção", horas: 18 },
  { etapa: "Acabamento", horas: 6 },
  { etapa: "Entrega", horas: 24 },
];

export const custoPorCategoria = [
  { name: "Material", value: 38, color: "#3b82f6" },
  { name: "Mão de obra", value: 22, color: "#8b5cf6" },
  { name: "Máquina", value: 18, color: "#f59e0b" },
  { name: "Acabamento", value: 9, color: "#10b981" },
  { name: "Entrega", value: 7, color: "#ef4444" },
  { name: "Outros", value: 6, color: "#6b7280" },
];

export const retrabalhoPorSetor = [
  { setor: "Design", qtd: 8 },
  { setor: "Impressão", qtd: 12 },
  { setor: "Recorte", qtd: 5 },
  { setor: "Acabamento", qtd: 9 },
  { setor: "Instalação", qtd: 3 },
];

export const maquinas = [
  {
    id: "m1",
    nome: "Plotter Impressão i1600 180",
    tipo: "Impressão digital",
    status: "em_uso",
    custoHora: 45,
    ocupacao: 78,
    operador: "Carlos M.",
  },
  {
    id: "m2",
    nome: "CNC 10060",
    tipo: "Corte/Gravação",
    status: "em_uso",
    custoHora: 38,
    ocupacao: 62,
    operador: "André L.",
  },
  {
    id: "m3",
    nome: "Impressora 3D Bambu Lab",
    tipo: "Impressão 3D",
    status: "em_uso",
    custoHora: 12,
    ocupacao: 91,
    operador: "Renata S.",
  },
  {
    id: "m4",
    nome: "Plotter de Recorte",
    tipo: "Recorte vinil",
    status: "parada",
    custoHora: 22,
    ocupacao: 0,
    operador: "Carlos M.",
  },
  {
    id: "m5",
    nome: "Máquina Corte/UV",
    tipo: "Corte/UV",
    status: "manutencao",
    custoHora: 55,
    ocupacao: 0,
    operador: "—",
  },
];

export const conversasWhatsapp = [
  {
    id: "c1",
    nome: "Marcos Silva",
    numero: "+55 11 98765-4321",
    ultima: "Tudo certo, pode produzir!",
    hora: "14:32",
    naoLidas: 0,
    etiqueta: "Produção",
  },
  {
    id: "c2",
    nome: "Padaria Aurora",
    numero: "+55 11 91234-5678",
    ultima: "Vocês fazem fachada em ACM?",
    hora: "14:18",
    naoLidas: 3,
    etiqueta: "Orçamento",
  },
  {
    id: "c3",
    nome: "Studio Vita",
    numero: "+55 11 99887-6655",
    ultima: "Comprovante anexo",
    hora: "13:45",
    naoLidas: 1,
    etiqueta: "Pagamento",
  },
  {
    id: "c4",
    nome: "Cliente novo",
    numero: "+55 11 98123-4567",
    ultima: "Bom dia, gostaria de um orçamento",
    hora: "12:10",
    naoLidas: 2,
    etiqueta: "Lead",
  },
  {
    id: "c5",
    nome: "Auto Posto BR",
    numero: "+55 11 97654-3210",
    ultima: "Quando posso retirar?",
    hora: "11:02",
    naoLidas: 0,
    etiqueta: "Pronto",
  },
];

export const leadsMock = [
  {
    id: "l1",
    nome: "Padaria Aurora",
    origem: "WhatsApp",
    interesse: "Fachada ACM",
    responsavel: "Bruno",
    status: "novo",
  },
  {
    id: "l2",
    nome: "Studio Vita",
    origem: "Instagram",
    interesse: "Banner evento",
    responsavel: "Bruno",
    status: "em_atendimento",
  },
  {
    id: "l3",
    nome: "Restaurante Capim",
    origem: "Indicação",
    interesse: "Cardápio impresso",
    responsavel: "Ana",
    status: "orcamento",
  },
  {
    id: "l4",
    nome: "Loja Bambu",
    origem: "Site",
    interesse: "Adesivo vitrine",
    responsavel: "Ana",
    status: "ganho",
  },
  {
    id: "l5",
    nome: "Auto Center XYZ",
    origem: "WhatsApp",
    interesse: "Placa fachada",
    responsavel: "Bruno",
    status: "perdido",
  },
];

export const materiaisMock = [
  { id: "mat1", nome: "Lona 440g", unidade: "m²", estoque: 142, minimo: 50, custo: 18.5 },
  { id: "mat2", nome: "Vinil branco brilho", unidade: "m²", estoque: 28, minimo: 40, custo: 22.0 },
  { id: "mat3", nome: "ACM 3mm branco", unidade: "m²", estoque: 18, minimo: 10, custo: 89.0 },
  { id: "mat4", nome: "Filamento PLA preto", unidade: "kg", estoque: 12.5, minimo: 5, custo: 95.0 },
  {
    id: "mat5",
    nome: "Tinta eco-solvente CMYK",
    unidade: "L",
    estoque: 3.2,
    minimo: 4,
    custo: 280.0,
  },
  { id: "mat6", nome: "MDF 6mm", unidade: "chapa", estoque: 7, minimo: 5, custo: 145.0 },
];

export const produtosMock = [
  {
    id: "p1",
    nome: "Adesivo vinil brilho",
    categoria: "Adesivos",
    preco: 89.0,
    custo: 32.0,
    margem: 64,
  },
  {
    id: "p2",
    nome: "Banner lona 440g",
    categoria: "Banners",
    preco: 65.0,
    custo: 28.0,
    margem: 57,
  },
  {
    id: "p3",
    nome: "Placa ACM com fixação",
    categoria: "Fachadas",
    preco: 320.0,
    custo: 145.0,
    margem: 55,
  },
  {
    id: "p4",
    nome: "Impressão 3D personalizada",
    categoria: "Impressão 3D",
    preco: 180.0,
    custo: 65.0,
    margem: 64,
  },
  {
    id: "p5",
    nome: "Corte CNC MDF",
    categoria: "CNC/Laser",
    preco: 220.0,
    custo: 95.0,
    margem: 57,
  },
];

export const entregasMock = [
  {
    id: "e1",
    os: "OS-1042",
    cliente: "Marcos Silva",
    tipo: "instalação",
    endereco: "R. Augusta, 1200 — São Paulo",
    data: "Hoje 15:00",
    status: "agendado",
  },
  {
    id: "e2",
    os: "OS-1038",
    cliente: "Padaria Aurora",
    tipo: "entrega",
    endereco: "Av. Paulista, 500",
    data: "Hoje 16:30",
    status: "em_rota",
  },
  {
    id: "e3",
    os: "OS-1035",
    cliente: "Auto Posto BR",
    tipo: "instalação",
    endereco: "Rod. Anhanguera km 24",
    data: "Amanhã 09:00",
    status: "agendado",
  },
  {
    id: "e4",
    os: "OS-1030",
    cliente: "Studio Vita",
    tipo: "entrega",
    endereco: "R. Oscar Freire, 800",
    data: "Ontem",
    status: "concluido",
  },
];

export const ocorrenciasMock = [
  {
    id: "o1",
    os: "OS-1040",
    tipo: "Arquivo ruim",
    setor: "Design",
    custo: 0,
    retrabalho: true,
    status: "aberta",
  },
  {
    id: "o2",
    os: "OS-1037",
    tipo: "Erro de produção",
    setor: "Impressão",
    custo: 145,
    retrabalho: true,
    status: "resolvida",
  },
  {
    id: "o3",
    os: "OS-1034",
    tipo: "Material danificado",
    setor: "Acabamento",
    custo: 89,
    retrabalho: false,
    status: "resolvida",
  },
  {
    id: "o4",
    os: "OS-1029",
    tipo: "Falha de máquina",
    setor: "Produção",
    custo: 320,
    retrabalho: true,
    status: "aberta",
  },
];

export const manutencoesMock = [
  {
    id: "mn1",
    maquina: "Plotter i1600",
    tipo: "Cabeça de impressão",
    dataPrevista: "05/06/2026",
    status: "agendada",
    custo: 850,
  },
  {
    id: "mn2",
    maquina: "CNC 10060",
    tipo: "Lubrificação eixos",
    dataPrevista: "12/06/2026",
    status: "agendada",
    custo: 120,
  },
  {
    id: "mn3",
    maquina: "Bambu Lab",
    tipo: "Troca de bico",
    dataPrevista: "28/05/2026",
    status: "concluida",
    custo: 45,
  },
  {
    id: "mn4",
    maquina: "Corte UV",
    tipo: "Calibração",
    dataPrevista: "02/06/2026",
    status: "em_andamento",
    custo: 280,
  },
];

export const respostasRapidasMock = [
  {
    id: "r1",
    categoria: "Orçamento",
    titulo: "Pedido de orçamento",
    texto:
      "Olá! Para preparar seu orçamento, me envie o tipo de material, medida, quantidade e se já possui a arte.",
  },
  {
    id: "r2",
    categoria: "Arquivo",
    titulo: "Envio de arquivo",
    texto:
      "Pode enviar o arquivo por aqui. Nossa equipe vai conferir qualidade, tamanho e formato antes da produção.",
  },
  {
    id: "r3",
    categoria: "Pagamento",
    titulo: "Confirmação pagamento",
    texto: "Para liberar a produção, precisamos da confirmação do pagamento de entrada.",
  },
  {
    id: "r4",
    categoria: "Arte",
    titulo: "Arte para aprovação",
    texto:
      "Sua arte está pronta para conferência. Verifique todos os dados com atenção antes da aprovação.",
  },
  {
    id: "r5",
    categoria: "Conclusão",
    titulo: "Pedido pronto",
    texto: "Seu pedido foi concluído e já está pronto para retirada/entrega.",
  },
];

export const automacoesMock = [
  {
    id: "a1",
    gatilho: "OS criada",
    mensagem: "Recebemos sua solicitação e já vamos analisar.",
    ativo: true,
  },
  {
    id: "a2",
    gatilho: "Orçamento enviado",
    mensagem: "Seu orçamento está pronto para análise.",
    ativo: true,
  },
  {
    id: "a3",
    gatilho: "Aguardando pagamento",
    mensagem: "Para liberar sua produção, confirme o pagamento.",
    ativo: true,
  },
  {
    id: "a4",
    gatilho: "Arte para aprovação",
    mensagem: "Sua arte está pronta para conferência.",
    ativo: true,
  },
  {
    id: "a5",
    gatilho: "Produção iniciada",
    mensagem: "Seu material entrou em produção.",
    ativo: false,
  },
  { id: "a6", gatilho: "Pronto para retirada", mensagem: "Seu pedido está pronto.", ativo: true },
];

export const artesPendentesMock = [
  {
    id: "ar1",
    os: "OS-1042",
    cliente: "Marcos Silva",
    designer: "Júlia",
    versao: 2,
    enviadaEm: "Hoje 11:20",
  },
  {
    id: "ar2",
    os: "OS-1041",
    cliente: "Padaria Aurora",
    designer: "Júlia",
    versao: 1,
    enviadaEm: "Hoje 10:05",
  },
  {
    id: "ar3",
    os: "OS-1039",
    cliente: "Studio Vita",
    designer: "Pedro",
    versao: 3,
    enviadaEm: "Ontem 17:40",
  },
];
