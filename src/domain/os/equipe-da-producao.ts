/**
 * Quem faz a criação e quem opera a máquina (14/11/2026).
 *
 * O dono pediu para escolher a pessoa — "não marque sempre pelo papel da pessoa,
 * pelo gestor": quem decide é o gestor, não o cadastro. Então a lista é a equipe
 * INTEIRA, e o papel só ordena: para a criação, quem é da criação (designer) ou do
 * atendimento (vendedor — na Bex Print o atendimento também cria) vem primeiro; para
 * a máquina, quem tem o papel de operador. O resto da equipe fica logo abaixo,
 * escolhível do mesmo jeito.
 *
 * Quem APROVA é só o gestor (decisão do dono, 14/11/2026): "o administrador só
 * visualiza a empresa". O admin não valida atendimento, não libera saldo devedor nem
 * margem, e não é citado nos pedidos.
 */

export type PessoaDaProducao = {
  id: string;
  nome: string | null;
  avatar_url: string | null;
  papeis: string[];
  /** Tem celular no cadastro: o aviso no grupo cita a pessoa com "@". */
  tem_whatsapp: boolean;
};

export type FuncaoNaOs = "criacao" | "operador";

const PAPEIS_DA_FUNCAO: Record<FuncaoNaOs, readonly string[]> = {
  criacao: ["designer", "vendedor"],
  operador: ["operador"],
};

/** Os papéis no vocabulário da casa. */
export const ROTULO_DO_PAPEL: Record<string, string> = {
  admin: "Admin",
  gestor: "Gestor",
  financeiro: "Financeiro",
  vendedor: "Atendimento",
  designer: "Criação",
  operador: "Operador",
  estoque: "Estoque",
  instalador: "Instalador",
};

export function papeisEmTexto(papeis: readonly string[]): string {
  return papeis
    .map((p) => ROTULO_DO_PAPEL[p])
    .filter(Boolean)
    .join(" · ");
}

const porNome = (a: PessoaDaProducao, b: PessoaDaProducao) =>
  (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR", { sensitivity: "base" });

/** Sugeridos (têm o papel da função) primeiro; o resto da equipe depois. Os dois por nome. */
export function equipeParaEscolher(
  equipe: readonly PessoaDaProducao[],
  funcao: FuncaoNaOs,
): { sugeridos: PessoaDaProducao[]; outros: PessoaDaProducao[] } {
  const papeis = PAPEIS_DA_FUNCAO[funcao];
  const sugerido = (p: PessoaDaProducao) => p.papeis.some((papel) => papeis.includes(papel));
  const sugeridos = equipe.filter(sugerido).sort(porNome);
  const outros = equipe.filter((p) => !sugerido(p)).sort(porNome);
  return { sugeridos, outros };
}

/** Só o gestor aprova: valida o atendimento e libera saldo devedor e margem. O admin só acompanha. */
export function ehGestor(papeis: readonly string[]): boolean {
  return papeis.includes("gestor");
}

/** "Maiara Brito" → "Maiara". */
export function primeiroNome(nome: string | null | undefined): string {
  return (nome ?? "").trim().split(/\s+/)[0] || "—";
}
