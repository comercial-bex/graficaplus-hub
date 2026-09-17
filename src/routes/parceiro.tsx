import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { carregarPainel, CHAVE_PAINEL, ehAcessoNegado } from "@/lib/parceiro-api";
import { Casca } from "@/components/parceiro/casca";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { mensagemErro } from "@/lib/erros";

export const Route = createFileRoute("/parceiro")({
  head: () => ({
    meta: [
      { title: "Painel do parceiro — Bex Print" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LayoutDoParceiro,
});

/**
 * Casa do parceiro revendedor, fora do layout da equipe.
 *
 * Fica fora de /_authenticated de propósito: aquele layout é o sistema da
 * gráfica (menu com financeiro, produção, clientes). O parceiro é de fora — ele
 * vê só o que é dele, num lugar pensado para o celular, onde ele vai orçar na
 * frente do cliente.
 */
function LayoutDoParceiro() {
  const { user, loading, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const ehParceiro = roles.includes("parceiro");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  const painel = useQuery({
    queryKey: CHAVE_PAINEL,
    queryFn: carregarPainel,
    enabled: !!user && ehParceiro,
    staleTime: 60_000,
    retry: (tentativas, erro) => !ehAcessoNegado(erro) && tentativas < 2,
  });

  if (loading || (user && ehParceiro && painel.isLoading)) return <Carregando />;
  if (!user) return null;

  if (!ehParceiro) {
    const daEquipe = roles.some((r) => r !== "cliente");
    return (
      <Aviso
        titulo={daEquipe ? "Este é o painel dos parceiros" : "Acesso de parceiro ainda não liberado"}
        texto={
          daEquipe
            ? "Você entrou com uma conta da equipe. O painel do parceiro é para quem revende com a própria marca — a gestão da rede fica em Parceiros, no sistema."
            : "Sua conta está criada, mas ainda não foi ligada a um cadastro de parceiro. Avise a gráfica: assim que ligarem, este painel abre com a sua tabela."
        }
        email={user.email ?? ""}
        acao={daEquipe ? { rotulo: "Ir para o sistema", para: "/dashboard" } : null}
        onSair={signOut}
      />
    );
  }

  if (painel.error || !painel.data) {
    return (
      <Aviso
        titulo={ehAcessoNegado(painel.error) ? "Acesso suspenso ou não liberado" : "O painel não carregou"}
        texto={
          ehAcessoNegado(painel.error)
            ? "Seu cadastro de parceiro não está ativo agora. Fale com a gráfica para reativar."
            : mensagemErro(painel.error)
        }
        email={user.email ?? ""}
        acao={null}
        onSair={signOut}
        tentarDeNovo={ehAcessoNegado(painel.error) ? undefined : () => painel.refetch()}
      />
    );
  }

  return (
    <Casca painel={painel.data} onSair={signOut}>
      <Outlet />
    </Casca>
  );
}

function Carregando() {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-16 border-b border-border" />
      <div className="mx-auto max-w-5xl space-y-4 px-4 pt-8">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-40 md:col-span-2" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}

function Aviso(props: {
  titulo: string;
  texto: string;
  email: string;
  acao: { rotulo: string; para: string } | null;
  onSair: () => void;
  tentarDeNovo?: () => void;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-1.5" style={{ background: "var(--gradient-cmyk)" }} />
      <div className="mx-auto max-w-lg space-y-4 px-6 py-20 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{props.titulo}</h1>
        <p className="text-muted-foreground">{props.texto}</p>
        <p className="text-sm text-muted-foreground">
          Conectado como <span className="font-medium text-foreground">{props.email}</span>
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {props.tentarDeNovo && <Button onClick={props.tentarDeNovo}>Tentar de novo</Button>}
          {props.acao && (
            <Button asChild>
              <a href={props.acao.para}>{props.acao.rotulo}</a>
            </Button>
          )}
          <Button variant="outline" onClick={props.onSair}>
            Sair
          </Button>
        </div>
      </div>
    </div>
  );
}
