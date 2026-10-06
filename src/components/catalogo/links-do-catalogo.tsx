import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Copy, Link2, Loader2, MessageCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";
import { mensagemErro } from "@/lib/erros";
import {
  VALIDADE_MAXIMA_DIAS,
  VALIDADE_PADRAO_DIAS,
  mensagemDoLinkDaVitrine,
  situacaoDaVitrine,
  textoDaVitrine,
  urlDaVitrine,
  validadeDoLink,
  type LinkDaVitrine,
} from "@/domain/catalogo/link-do-catalogo";
import { linkDoWhatsapp as whatsappDoCliente } from "@/domain/portal/link-do-portal";
import { gerarLink, lerClientes, lerLinks, revogarLink } from "@/components/catalogo/consultas";

const SEM_CLIENTE = "__sem_cliente__";

/**
 * Os links de vitrine de um catálogo: quem recebeu, até quando vale, quantas
 * vezes o cliente abriu — e o botão de cancelar. O endereço em si não aparece
 * aqui: o token existe em claro uma vez só, na hora de gerar (o banco guarda o
 * hash). Perdeu o endereço? Gere outro e cancele este.
 */
export function LinksDoCatalogo({ catalogoId }: { catalogoId: string }) {
  const qc = useQueryClient();
  const links = useQuery({ queryKey: ["catalogo-links", catalogoId], queryFn: () => lerLinks(catalogoId) });
  const [cancelando, setCancelando] = useState<LinkDaVitrine | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function cancelar() {
    if (!cancelando) return;
    setOcupado(true);
    try {
      await revogarLink(cancelando.id);
      toast.success("Link cancelado: o cliente passa a ver \"catálogo indisponível\".");
      qc.invalidateQueries({ queryKey: ["catalogo-links", catalogoId] });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setOcupado(false);
      setCancelando(null);
    }
  }

  if (links.isPending) return <p className="text-sm text-muted-foreground">Carregando os links…</p>;
  if (links.isError) {
    return (
      <FalhaDeConsulta
        titulo="Não deu para carregar os links"
        erro={links.error}
        onTentarDeNovo={() => void links.refetch()}
      />
    );
  }
  const agora = new Date(links.data.agora);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Para gerar um link, vá à aba Itens, toque em "Escolher itens para o link", marque os itens (só os com foto)
        e gere. O endereço aparece uma vez só.
      </p>
      {links.data.links.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Nenhum link gerado ainda.</CardContent>
        </Card>
      ) : (
        links.data.links.map((l) => {
          const situacao = situacaoDaVitrine(l, agora);
          return (
            <Card key={l.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <Link2 className="h-4 w-4" /> {l.titulo}
                    <Badge variant={situacao === "ativo" ? "default" : "outline"}>
                      {situacao === "ativo" ? "Ativo" : situacao === "vencido" ? "Vencido" : "Cancelado"}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {l.cliente ? `Para ${l.cliente} · ` : ""}
                    {l.itens} itens · gerado por {l.criado_por ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">{textoDaVitrine(l, agora)}</p>
                </div>
                {situacao === "ativo" && (
                  <Button variant="outline" className="h-11 md:h-9" onClick={() => setCancelando(l)}>
                    <Ban className="mr-1 h-4 w-4" /> Cancelar
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      <AlertDialog open={!!cancelando} onOpenChange={(v) => !v && setCancelando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar o link "{cancelando?.titulo}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Quem abrir o endereço passa a ver "catálogo indisponível". Não dá para reativar: para o cliente voltar
              a ver, gere um link novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ocupado}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={ocupado}
              onClick={(e) => {
                e.preventDefault();
                void cancelar();
              }}
            >
              {ocupado && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Cancelar o link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Gera o link da vitrine com os itens escolhidos e mostra o endereço uma única vez. */
export function GerarLinkDialog({
  aberto,
  catalogoId,
  itens,
  onOpenChange,
  onGerado,
}: {
  aberto: boolean;
  catalogoId: string;
  itens: string[];
  onOpenChange: (aberto: boolean) => void;
  onGerado: () => void;
}) {
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState("Catálogo de brindes");
  const [clienteId, setClienteId] = useState(SEM_CLIENTE);
  const [dias, setDias] = useState(String(VALIDADE_PADRAO_DIAS));
  const [gerando, setGerando] = useState(false);
  const [gerado, setGerado] = useState<{ url: string; venceEm: string; itens: number; ignorados: number } | null>(
    null,
  );
  const clientes = useQuery({ queryKey: ["catalogo-clientes"], enabled: aberto, queryFn: lerClientes });

  useEffect(() => {
    if (aberto) {
      setGerado(null);
      setTitulo("Catálogo de brindes");
      setClienteId(SEM_CLIENTE);
      setDias(String(VALIDADE_PADRAO_DIAS));
    }
  }, [aberto]);

  const cliente = clientes.data?.find((c) => c.id === clienteId) ?? null;

  async function gerar() {
    setGerando(true);
    try {
      const r = await gerarLink({
        catalogoId,
        itens,
        titulo: titulo.trim(),
        clienteId: clienteId === SEM_CLIENTE ? null : clienteId,
        dias: validadeDoLink(dias),
      });
      setGerado({
        url: urlDaVitrine(window.location.origin, r.token),
        venceEm: r.expira_em,
        itens: r.itens,
        ignorados: r.ignorados,
      });
      qc.invalidateQueries({ queryKey: ["catalogo-links", catalogoId] });
      onGerado();
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setGerando(false);
    }
  }

  const mensagem = gerado ? mensagemDoLinkDaVitrine(cliente?.nome, gerado.url, gerado.venceEm) : "";
  const whatsapp = gerado
    ? (whatsappDoCliente(cliente?.telefone, mensagem) ??
      `https://wa.me/?text=${encodeURIComponent(mensagem)}`)
    : null;

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{gerado ? "Link pronto" : "Link para o cliente"}</DialogTitle>
          <DialogDescription>
            {gerado
              ? "Copie agora: por segurança, este endereço não aparece de novo."
              : `${itens.length} itens escolhidos. O cliente vê foto, nome, especificação, código BX e preço de venda — nunca o fornecedor nem o custo.`}
          </DialogDescription>
        </DialogHeader>

        {gerado ? (
          <div className="space-y-3">
            <Input readOnly value={gerado.url} className="h-11 font-mono text-xs" onFocus={(e) => e.target.select()} />
            <p className="text-sm text-muted-foreground">
              {gerado.itens} itens no link
              {gerado.ignorados > 0 ? ` · ${gerado.ignorados} ficaram de fora por não ter foto` : ""}.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                className="h-11 md:h-9"
                onClick={() => {
                  void navigator.clipboard.writeText(gerado.url).then(
                    () => toast.success("Endereço copiado."),
                    () => toast.error("O navegador não deixou copiar: selecione o endereço e copie à mão."),
                  );
                }}
              >
                <Copy className="mr-1 h-4 w-4" /> Copiar
              </Button>
              {whatsapp && (
                <Button asChild variant="outline" className="h-11 md:h-9">
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="mr-1 h-4 w-4" /> Mandar no WhatsApp
                  </a>
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="link-titulo">Título (o cliente lê no alto da página)</Label>
              <Input
                id="link-titulo"
                value={titulo}
                maxLength={120}
                onChange={(e) => setTitulo(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cliente (opcional)</Label>
              {clientes.isError ? (
                <FalhaDeConsulta
                  titulo="Não deu para carregar os clientes"
                  erro={clientes.error}
                  onTentarDeNovo={() => void clientes.refetch()}
                />
              ) : (
                <Select value={clienteId} onValueChange={setClienteId} disabled={clientes.isLoading}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_CLIENTE}>Sem cliente definido</SelectItem>
                    {(clientes.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="link-dias">Vale por quantos dias (até {VALIDADE_MAXIMA_DIAS})</Label>
              <Input
                id="link-dias"
                inputMode="numeric"
                value={dias}
                onChange={(e) => setDias(e.target.value.replace(/\D/g, ""))}
                className="h-11 w-32"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {gerado ? (
            <Button className="h-11 md:h-9" onClick={() => onOpenChange(false)}>
              Pronto
            </Button>
          ) : (
            <>
              <Button variant="outline" className="h-11 md:h-9" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                className="h-11 md:h-9"
                disabled={gerando || !titulo.trim() || itens.length === 0}
                onClick={() => void gerar()}
              >
                {gerando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Gerar link
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
