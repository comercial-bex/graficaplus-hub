/**
 * Novo usuário em passos (25/10/2026): perfil, pessoa, acesso, revisão.
 *
 * O perfil vem primeiro porque é a decisão que importa (o que a pessoa vê e faz); nome e e-mail
 * são só preenchimento. As descrições dos perfis seguem o organograma da gráfica; o que cada perfil
 * pode exatamente fica em Equipe e acessos › Permissões, e esta tela não promete além disso.
 *
 * Regras do cadastro de antes: nome e e-mail obrigatórios, senha inicial de pelo menos 8
 * caracteres, perfil opcional (a pessoa pode entrar sem perfil e receber depois).
 */

export type NumeroDoPasso = 1 | 2 | 3 | 4;

export const PASSOS_DO_USUARIO: readonly { n: NumeroDoPasso; titulo: string; pergunta: string }[] =
  [
    { n: 1, titulo: "Perfil", pergunta: "O que esta pessoa faz na gráfica?" },
    { n: 2, titulo: "Pessoa", pergunta: "Quem é?" },
    { n: 3, titulo: "Acesso", pergunta: "Como ela entra pela primeira vez?" },
    { n: 4, titulo: "Revisão", pergunta: "Está tudo certo?" },
  ];

export type PerfilDeAcesso = {
  chave:
    | "admin"
    | "gestor"
    | "financeiro"
    | "vendedor"
    | "designer"
    | "operador"
    | "estoque"
    | "instalador";
  titulo: string;
  detalhe: string;
  icone: string;
};

export const PERFIS_DO_CADASTRO: readonly PerfilDeAcesso[] = [
  {
    chave: "vendedor",
    titulo: "Atendimento",
    detalhe: "recebe o arquivo, monta o orçamento e manda para a produção",
    icone: "Headset",
  },
  {
    chave: "operador",
    titulo: "Impressão e acabamento",
    detalhe: "imprime, acaba e entrega",
    icone: "Printer",
  },
  {
    chave: "gestor",
    titulo: "Gerência",
    detalhe: "gerente de vendas e produção; confirma a baixa de material",
    icone: "Briefcase",
  },
  {
    chave: "financeiro",
    titulo: "Financeiro",
    detalhe: "contas a pagar e a receber, comissões, custos",
    icone: "Wallet",
  },
  { chave: "designer", titulo: "Design", detalhe: "cria e ajusta as artes", icone: "Palette" },
  { chave: "estoque", titulo: "Estoque", detalhe: "entrada e saída de material", icone: "Boxes" },
  {
    chave: "instalador",
    titulo: "Instalação",
    detalhe: "entregas e instalações em campo",
    icone: "Truck",
  },
  {
    chave: "admin",
    titulo: "Administrador",
    detalhe: "vê e faz tudo; cuida dos acessos",
    icone: "ShieldCheck",
  },
];

export type RespostasDoUsuario = {
  perfil: PerfilDeAcesso["chave"] | "";
  nome: string;
  email: string;
  telefone: string;
  cargo: string;
  senha: string;
  ativo: boolean;
};

export const RESPOSTAS_VAZIAS_DO_USUARIO: RespostasDoUsuario = {
  perfil: "",
  nome: "",
  email: "",
  telefone: "",
  cargo: "",
  senha: "",
  ativo: true,
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Senha inicial: 10 caracteres sem os que se confundem (0/O, 1/l/I) e o sufixo `@7`. */
export function gerarSenhaInicial(aleatorios: ArrayLike<number>): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[(aleatorios[i] ?? 0) % chars.length];
  return `${out}@7`;
}

/** O cargo que se sugere a partir do perfil, enquanto o campo está vazio. */
export function cargoSugerido(perfil: RespostasDoUsuario["perfil"]): string {
  return PERFIS_DO_CADASTRO.find((p) => p.chave === perfil)?.titulo ?? "";
}

/** Por que o passo ainda não pode avançar, ou nada. */
export function pendenciaDoPassoDoUsuario(
  passo: NumeroDoPasso,
  r: RespostasDoUsuario,
): string | null {
  switch (passo) {
    case 1:
      return null; // perfil é opcional: dá para entrar sem e receber depois
    case 2:
      if (r.nome.trim().length < 2) return "Informe o nome (pelo menos 2 letras).";
      if (!EMAIL.test(r.email.trim()))
        return "Informe um e-mail válido: é com ele que a pessoa entra.";
      return null;
    case 3:
      return r.senha.length >= 8 ? null : "A senha inicial precisa de ao menos 8 caracteres.";
    case 4:
      return null;
  }
}

/** O pedido ao servidor, como o cadastro de antes manda (perfil só quando escolhido). */
export function usuarioDasRespostas(r: RespostasDoUsuario) {
  return {
    nome: r.nome.trim(),
    email: r.email.trim(),
    senha: r.senha,
    telefone: r.telefone.trim() || null,
    cargo: r.cargo.trim() || cargoSugerido(r.perfil) || null,
    ativo: r.ativo,
    ...(r.perfil ? { role: r.perfil } : {}),
  };
}
