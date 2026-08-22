import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Check, Loader2, PencilLine } from "lucide-react";
import { toast } from "sonner";

/**
 * Aprovação de arte pelo cliente — página PÚBLICA, sem login.
 *
 * Fica fora de `_authenticated` de propósito: exigir conta para aprovar uma arte
 * é o que faz a gráfica voltar para o WhatsApp e perder o registro da aprovação.
 * Tudo passa por três funções no banco que recebem o token, conferem o hash e só
 * devolvem o daquele arquivo.
 */
export const Route = createFileRoute("/aprovar/$token")({
  head: () => ({ meta: [{ title: "Aprovação de arte" }] }),
  component: AprovarArtePage,
});

type Abertura = {
  situacao: "aberto" | "expirado" | "revogado" | "respondido" | "invalido";
  arquivo_nome?: string;
  arquivo_caminho?: string;
  bucket?: string;
  os_numero?: number;
  os_titulo?: string;
  cliente?: string;
  empresa?: string;
  expira_em?: string;
  expirou_em?: string;
  decisao?: string;
  respondido_em?: string;
};

function AprovarArtePage() {
  const { token } = Route.useParams();
  const [ajusteAberto, setAjusteAberto] = useState(false);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [decidido, setDecidido] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["aprovacao", token],
    queryFn: async (): Promise<Abertura> => {
      const { data, error } = await (supabase.rpc as any)("abrir_aprovacao", { p_token: token });
      if (error) throw error;
      return data as Abertura;
    },
  });

  async function decidir(decisao: "aprovado" | "ajuste") {
    setEnviando(true);
    const { error } = await (supabase.rpc as any)("registrar_decisao_aprovacao", {
      p_token: token,
      p_decisao: decisao,
      p_comentario: decisao === "ajuste" ? comentario : null,
    });
    setEnviando(false);
    if (error) return toast.error(error.message);
    setDecidido(decisao);
    void refetch();
  }

  if (isLoading) {
    return (
      <Moldura>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Abrindo a arte…
        </div>
      </Moldura>
    );
  }

  const situacao = data?.situacao ?? "invalido";
  const empresa = data?.empresa ?? "BEX PRINT";

  if (decidido || situacao === "respondido") {
    const decisao = decidido ?? data?.decisao;
    return (
      <Moldura empresa={empresa}>
        <div className="text-center space-y-3 py-8">
          <div
            className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${
              decisao === "aprovado" ? "bg-accent/15 text-accent" : "bg-amber-500/15 text-amber-600"
            }`}
          >
            {decisao === "aprovado" ? (
              <Check className="h-7 w-7" />
            ) : (
              <PencilLine className="h-7 w-7" />
            )}
          </div>
          <h1 className="text-xl font-semibold">
            {decisao === "aprovado" ? "Arte aprovada" : "Ajuste solicitado"}
          </h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            {decisao === "aprovado"
              ? `Obrigado! A equipe da ${empresa} já foi avisada e o pedido segue para produção.`
              : `Sua observação foi registrada e a equipe da ${empresa} vai refazer a arte. Você receberá um novo link.`}
          </p>
        </div>
      </Moldura>
    );
  }

  if (situacao !== "aberto") {
    const mensagem: Record<string, string> = {
      invalido: "Este link não existe. Confira se copiou o endereço inteiro.",
      revogado: "Este link foi cancelado pela gráfica — provavelmente porque a arte mudou.",
      expirado: "Este link venceu. Peça um novo à equipe e você poderá aprovar em seguida.",
    };
    return (
      <Moldura empresa={empresa}>
        <div className="text-center space-y-3 py-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15 text-amber-600">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-semibold">Link indisponível</h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            {mensagem[situacao] ?? mensagem.invalido}
          </p>
        </div>
      </Moldura>
    );
  }

  return (
    <Moldura empresa={empresa}>
      <div className="space-y-5">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Confira a arte do pedido {data?.os_numero}
          </h1>
          <p className="text-muted-foreground">
            {data?.cliente ? `${data.cliente} · ` : ""}
            {data?.os_titulo ?? data?.arquivo_nome}
          </p>
        </div>

        <ArtePreview caminho={data!.arquivo_caminho!} bucket={data!.bucket ?? "arquivos-clientes"} />

        <p className="text-sm text-muted-foreground">
          Olhe com atenção textos, telefones e cores. Depois de aprovada, a arte vai para a
          máquina exatamente como está aqui.
        </p>

        {!ajusteAberto ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <Button size="lg" className="flex-1" disabled={enviando} onClick={() => decidir("aprovado")}>
              <Check className="h-4 w-4 mr-1" />
              {enviando ? "Enviando…" : "Aprovar e liberar para produção"}
            </Button>
            <Button size="lg" variant="outline" className="flex-1" onClick={() => setAjusteAberto(true)}>
              <PencilLine className="h-4 w-4 mr-1" /> Pedir ajuste
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <label htmlFor="ajuste" className="text-sm font-medium">
              O que precisa mudar?
            </label>
            <Textarea
              id="ajuste"
              rows={4}
              autoFocus
              placeholder="Ex.: o telefone está errado, o certo é (96) 99111-6169. E o logo precisa ficar maior."
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
            />
            <div className="flex gap-2">
              <Button disabled={enviando} onClick={() => decidir("ajuste")}>
                {enviando ? "Enviando…" : "Enviar pedido de ajuste"}
              </Button>
              <Button variant="ghost" onClick={() => setAjusteAberto(false)}>
                Voltar
              </Button>
            </div>
          </div>
        )}

        {data?.expira_em && (
          <p className="text-xs text-muted-foreground">
            Este link vale até {new Date(data.expira_em).toLocaleDateString("pt-BR")}.
          </p>
        )}
      </div>
    </Moldura>
  );
}

/**
 * A imagem vem pelo Storage com a chave pública: a policy só libera o objeto
 * enquanto existe link de aprovação vivo apontando para ele. Por isso `download`
 * em vez de URL assinada — assinar exige sessão, que o cliente não tem.
 */
function ArtePreview({ caminho, bucket }: { caminho: string; bucket: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let cancelado = false;
    let criada: string | null = null;
    (async () => {
      const { data, error } = await supabase.storage.from(bucket).download(caminho);
      if (cancelado) return;
      if (error || !data) return setErro(true);
      criada = URL.createObjectURL(data);
      setUrl(criada);
    })();
    return () => {
      cancelado = true;
      if (criada) URL.revokeObjectURL(criada);
    };
  }, [caminho, bucket]);

  const ehPdf = caminho.toLowerCase().endsWith(".pdf");

  if (erro) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm flex gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          Não consegui carregar a imagem da arte. Peça o arquivo à equipe antes de aprovar — não
          aprove sem ver.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-muted/30 overflow-hidden">
      {!url ? (
        <div className="h-64 grid place-items-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : ehPdf ? (
        <object data={url} type="application/pdf" className="w-full h-[70vh]">
          <div className="p-4 text-sm">
            <a href={url} download className="underline">
              Baixar a arte em PDF
            </a>
          </div>
        </object>
      ) : (
        <img src={url} alt="Arte a ser impressa" className="w-full h-auto" />
      )}
    </div>
  );
}

function Moldura({ children, empresa }: { children: React.ReactNode; empresa?: string }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-1.5" style={{ background: "var(--gradient-cmyk)" }} />
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        {empresa && (
          <div className="mb-6 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            {empresa}
          </div>
        )}
        <Card>
          <CardContent className="p-5 sm:p-7">{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}
