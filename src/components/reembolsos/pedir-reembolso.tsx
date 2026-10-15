import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip } from "@/components/bex/StatusChip";
import {
  BUCKET_DO_COMPROVANTE,
  CATEGORIAS_DA_OS,
  COR,
  caminhoDoComprovante,
  fraseDaMargem,
  hojeNaCasa,
  lerValor,
  type DestinoDoReembolso,
} from "@/domain/financeiro/reembolsos";
import { CHAVE_DOS_REEMBOLSOS, consultarSemaforo } from "@/components/reembolsos/dados";

type OsParaEscolher = {
  id: string;
  numero: number;
  titulo: string | null;
  status: string;
  cliente: { nome: string | null } | null;
};

/**
 * O pedido de reembolso: o que comprou, quanto, para qual OS (ou a empresa) e
 * a foto do cupom. Enquanto a pessoa preenche, o semáforo da OS já diz quem
 * vai decidir — e, para quem decide, a margem antes e depois.
 *
 * A foto sobe primeiro (para a pasta da própria pessoa) e só depois o pedido é
 * gravado; o banco confere que a foto chegou e é da pasta de quem pede.
 */
export function PedirReembolso({
  aberto,
  aoFechar,
  osInicial,
}: {
  aberto: boolean;
  aoFechar: () => void;
  /** Abre com a OS já escolhida (botão "Pedir reembolso" da OS). */
  osInicial?: string | null;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [destino, setDestino] = useState<DestinoDoReembolso>("os");
  const [osId, setOsId] = useState<string | null>(osInicial ?? null);
  const [busca, setBusca] = useState("");
  const [itemId, setItemId] = useState<string>("");
  const [categoria, setCategoria] = useState<string>("material");
  const [valorTexto, setValorTexto] = useState("");
  const [dataCompra, setDataCompra] = useState(hojeNaCasa());
  const [descricao, setDescricao] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);

  useEffect(() => {
    if (aberto) setOsId(osInicial ?? null);
  }, [aberto, osInicial]);

  useEffect(() => {
    if (!arquivo || !arquivo.type.startsWith("image/")) {
      setPrevia(null);
      return;
    }
    const url = URL.createObjectURL(arquivo);
    setPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);

  const ordens = useQuery({
    queryKey: ["reembolso-os-para-escolher"],
    enabled: aberto,
    queryFn: async () => {
      // O nome do cliente só vem para quem lê clientes; para os outros a OS
      // aparece pelo número e pelo título.
      const { data, error } = await supabase
        .from("ordens_servico")
        .select("id, numero, titulo, status, cliente:clientes(nome)")
        .neq("status", "cancelado")
        .order("numero", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as unknown as OsParaEscolher[];
    },
  });

  const itens = useQuery({
    queryKey: ["reembolso-itens-da-os", osId],
    enabled: aberto && destino === "os" && !!osId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("itens_os")
        .select("id, descricao, quantidade, ordem")
        .eq("os_id", osId as string)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as { id: string; descricao: string | null; quantidade: number | null }[];
    },
  });

  const valor = lerValor(valorTexto);
  const semaforo = useQuery({
    queryKey: ["reembolso-semaforo", osId, valor],
    enabled: aberto && destino === "os" && !!osId && valor !== null,
    queryFn: () => consultarSemaforo(osId as string, valor as number),
  });

  const escolhida = ordens.data?.find((o) => o.id === osId) ?? null;
  const achadas = useMemo(() => {
    const termo = busca.trim().toLowerCase().replace(/^#/, "");
    const lista = ordens.data ?? [];
    if (!termo) return lista.slice(0, 8);
    return lista
      .filter((o) =>
        [String(o.numero), o.titulo ?? "", o.cliente?.nome ?? ""].some((t) => t.toLowerCase().includes(termo)),
      )
      .slice(0, 8);
  }, [busca, ordens.data]);

  function limpar() {
    setDestino("os");
    setOsId(osInicial ?? null);
    setBusca("");
    setItemId("");
    setCategoria("material");
    setValorTexto("");
    setDataCompra(hojeNaCasa());
    setDescricao("");
    setFornecedor("");
    setArquivo(null);
  }

  const pedir = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Entre de novo para pedir o reembolso.");
      if (valor === null) throw new Error("Informe o valor que você pagou (ex.: 15,50).");
      if (!descricao.trim()) throw new Error("Diga o que foi comprado.");
      if (!dataCompra || dataCompra > hojeNaCasa()) throw new Error("A data da compra não pode ser depois de hoje.");
      if (destino === "os" && !osId) throw new Error("Escolha a OS para a qual a compra foi feita.");
      if (!arquivo) throw new Error("Anexe a foto do cupom ou da nota: sem comprovante não há reembolso.");

      const caminho = caminhoDoComprovante(user.id, arquivo.name);
      const envio = await supabase.storage
        .from(BUCKET_DO_COMPROVANTE)
        .upload(caminho, arquivo, { contentType: arquivo.type || undefined });
      if (envio.error) throw envio.error;

      const { data, error } = await (supabase as any).rpc("reembolso_pedir", {
        p_valor: valor,
        p_descricao: descricao.trim(),
        p_data_compra: dataCompra,
        p_categoria: destino === "empresa" ? "despesa_geral" : categoria,
        p_destino: destino,
        p_comprovante_path: caminho,
        p_os_id: destino === "os" ? osId : null,
        p_os_item_id: destino === "os" && itemId ? itemId : null,
        p_fornecedor: fornecedor.trim() || null,
      });
      if (error) throw error;
      return data as { numero: number; cor: string; quem_aprova: "financeiro" | "gerencia" };
    },
    onSuccess: (r) => {
      toast.success(
        `Pedido nº ${r.numero} enviado. ${r.quem_aprova === "financeiro" ? "O financeiro aprova" : "A gerência decide"}; aprovado, entra no pagamento da sexta.`,
      );
      qc.invalidateQueries({ queryKey: [CHAVE_DOS_REEMBOLSOS] });
      limpar();
      aoFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const s = semaforo.data;
  const margem = fraseDaMargem(s);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && !pedir.isPending && aoFechar()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pedir reembolso</DialogTitle>
          <DialogDescription>
            Comprou algo para a gráfica com o seu dinheiro? Diga para qual OS foi e mande a foto do cupom. O
            aprovado é pago na sexta.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Para onde foi a compra">
            {(
              [
                ["os", "Para uma OS", "material, embalagem, frete…"],
                ["empresa", "Para a empresa", "café, limpeza, escritório"],
              ] as const
            ).map(([v, titulo, ex]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={destino === v}
                onClick={() => setDestino(v)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  destino === v ? "border-primary bg-primary/10 font-semibold" : "border-border hover:bg-muted"
                }`}
              >
                {titulo}
                <span className="block text-xs font-normal text-muted-foreground">{ex}</span>
              </button>
            ))}
          </div>

          {destino === "os" && (
            <div className="space-y-2">
              <Label htmlFor="reembolso-os">Qual OS?</Label>
              {escolhida ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    <strong>OS #{escolhida.numero}</strong> · {escolhida.titulo?.trim() || "sem título"}
                    {escolhida.cliente?.nome ? ` · ${escolhida.cliente.nome}` : ""}
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setOsId(null)}>
                    Trocar
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    id="reembolso-os"
                    placeholder="Número da OS, título ou cliente"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    inputMode="search"
                  />
                  {ordens.isError ? (
                    <p role="alert" className="text-xs text-destructive">
                      Não foi possível ler as OS: {mensagemErro(ordens.error)}
                    </p>
                  ) : (
                    <ul className="max-h-48 overflow-y-auto rounded-lg border border-border">
                      {ordens.isPending && <li className="px-3 py-2 text-xs text-muted-foreground">Carregando…</li>}
                      {!ordens.isPending && achadas.length === 0 && (
                        <li className="px-3 py-2 text-xs text-muted-foreground">Nenhuma OS com esse número ou nome.</li>
                      )}
                      {achadas.map((o) => (
                        <li key={o.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setOsId(o.id);
                              setItemId("");
                            }}
                            className="w-full truncate px-3 py-2 text-left text-sm hover:bg-muted"
                          >
                            <strong>#{o.numero}</strong> · {o.titulo?.trim() || "sem título"}
                            {o.cliente?.nome ? ` · ${o.cliente.nome}` : ""}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {(itens.data?.length ?? 0) > 1 && (
                <div className="space-y-1">
                  <Label>Para qual item da OS? (opcional)</Label>
                  <Select value={itemId || "todos"} onValueChange={(v) => setItemId(v === "todos" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">A OS toda</SelectItem>
                      {itens.data?.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.descricao?.trim() || "Item sem descrição"}
                          {i.quantidade ? ` · ${i.quantidade} un.` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1">
                <Label>O que é a compra?</Label>
                <Select value={categoria} onValueChange={setCategoria}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS_DA_OS.map((c) => (
                      <SelectItem key={c.valor} value={c.valor}>
                        {c.rotulo} — {c.exemplo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="reembolso-valor">Valor pago (R$)</Label>
              <Input
                id="reembolso-valor"
                inputMode="decimal"
                placeholder="ex.: 15,50"
                value={valorTexto}
                onChange={(e) => setValorTexto(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reembolso-data">Data do cupom</Label>
              <Input
                id="reembolso-data"
                type="date"
                max={hojeNaCasa()}
                value={dataCompra}
                onChange={(e) => setDataCompra(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="reembolso-descricao">O que comprou?</Label>
            <Textarea
              id="reembolso-descricao"
              rows={2}
              placeholder="ex.: 20 sacolas kraft para os brindes"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reembolso-fornecedor">Onde comprou? (opcional)</Label>
            <Input
              id="reembolso-fornecedor"
              placeholder="ex.: Papelaria do centro"
              value={fornecedor}
              onChange={(e) => setFornecedor(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reembolso-foto">Foto do cupom ou da nota</Label>
            <label
              htmlFor="reembolso-foto"
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm hover:bg-muted"
            >
              <Camera className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{arquivo ? arquivo.name : "Tirar foto ou escolher arquivo"}</span>
            </label>
            <input
              id="reembolso-foto"
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
            {previa && (
              <img src={previa} alt="Prévia do comprovante" className="max-h-40 rounded-md border border-border object-contain" />
            )}
          </div>

          {destino === "os" && osId && valor !== null && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm" aria-live="polite">
              {semaforo.isPending ? (
                <p className="text-muted-foreground">Conferindo a margem da OS…</p>
              ) : semaforo.isError ? (
                <p role="alert" className="text-destructive">
                  Não foi possível conferir a OS: {mensagemErro(semaforo.error)}
                </p>
              ) : s ? (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip label={COR[s.cor].rotulo} tone={COR[s.cor].tom} />
                    <span className="font-medium">{COR[s.cor].quem}</span>
                  </div>
                  <p className="text-muted-foreground">{s.motivo}</p>
                  {margem && <p className="font-medium">{margem}</p>}
                  {s.os_fechada && (
                    <p className="text-status-amber">A OS já foi concluída: o pedido entra marcado como depois do fechamento.</p>
                  )}
                </div>
              ) : null}
            </div>
          )}
          {destino === "empresa" && (
            <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              Despesa da empresa não entra em OS nenhuma: o financeiro aprova.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={aoFechar} disabled={pedir.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => pedir.mutate()} disabled={pedir.isPending}>
            {pedir.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
            Enviar pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
