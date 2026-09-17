import { useQuery } from "@tanstack/react-query";
import { Check, Circle, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

/**
 * O roteiro de quem está montando a rede.
 *
 * Some sozinho quando os três passos estão feitos. A ordem importa: a régua de
 * níveis define o preço que o parceiro vai ver no primeiro acesso dele — mexer
 * nela depois de convidar gente é mudar o combinado no meio do jogo.
 */
export function ComoComecar({
  parceiros,
  comLogin,
  podeEditar,
}: {
  parceiros: number;
  comLogin: number;
  podeEditar: boolean;
}) {
  const { data: incentivos = 0 } = useQuery({
    queryKey: ["parceiros-tem-incentivo"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cliente = supabase as any;
      const [metas, ofertas] = await Promise.all([
        cliente.from("parceiro_campanhas").select("id", { count: "exact", head: true }),
        cliente.from("parceiro_ofertas").select("id", { count: "exact", head: true }),
      ]);
      return Number(metas.count ?? 0) + Number(ofertas.count ?? 0);
    },
    staleTime: 60_000,
  });

  const passos = [
    {
      feito: parceiros > 0,
      titulo: "Cadastre o primeiro parceiro",
      texto: "A partir de um cliente que já existe — é pelo cadastro dele que as compras contam para nível e meta.",
    },
    {
      feito: comLogin > 0,
      titulo: "Dê o acesso ao painel",
      texto: "No menu do parceiro, em “Dar acesso”. O sistema gera a mensagem pronta para mandar no WhatsApp.",
    },
    {
      feito: incentivos > 0,
      titulo: "Crie a primeira meta ou oferta",
      texto: "É o que faz o parceiro voltar ao painel. Meta é prêmio garantido; oferta é preço menor por alguns dias.",
    },
  ];

  if (!podeEditar || passos.every((p) => p.feito)) return null;

  return (
    <section className="rounded-xl border border-[color:var(--bex-cyan)]/30 bg-[color:var(--bex-cyan)]/5 p-4">
      <p className="flex items-center gap-2 font-semibold">
        <Compass className="h-4 w-4 text-[color:var(--bex-cyan)]" />
        Como montar a rede
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {passos.filter((p) => p.feito).length} de {passos.length}
        </span>
      </p>
      <ol className="mt-2 space-y-1.5">
        {passos.map((p) => (
          <li key={p.titulo} className="flex items-start gap-2 text-sm">
            {p.feito ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--bex-cyan)]" />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0">
              <span className={cn("font-medium", p.feito && "text-muted-foreground line-through")}>{p.titulo}</span>
              {!p.feito && <span className="block text-muted-foreground">{p.texto}</span>}
            </span>
          </li>
        ))}
      </ol>
      {parceiros === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Antes de convidar alguém, confira a aba <span className="font-medium text-foreground">Níveis</span>: é o preço
          que o parceiro vai ver no primeiro acesso.
        </p>
      )}
    </section>
  );
}
