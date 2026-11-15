import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  montarTextoAviso,
  motivoDoIntervalo,
  quantidadePermitida,
  type PublicoAviso,
} from "@/domain/parceiros/avisos";
import { publicoAviso, historicoAvisos, salvarAviso, enviarAviso } from "@/lib/parceiro-avisos-api";
import { mensagemErro } from "@/lib/erros";
const publicos: Record<PublicoAviso, string> = {
  ativos: "Todos os ativos",
  sem_compra: "Ativos que ainda não compraram",
  com_credito: "Ativos com crédito disponível",
  terceirizados: "Terceirizados que já compram",
};
export function AvisosTab({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [publico, setPublico] = useState<PublicoAviso>("ativos");
  const [desmarcados, setDesmarcados] = useState<string[]>([]);
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [rascunho, setRascunho] = useState<string | null>(null);
  const [recusados, setRecusados] = useState<{ parceiro_id: string; motivo: string }[]>([]);
  const lista = useQuery({
    queryKey: ["parceiro-aviso-publico", publico],
    queryFn: () => publicoAviso(publico),
  });
  const historico = useQuery({
    queryKey: ["parceiro-avisos-historico"],
    queryFn: historicoAvisos,
    refetchInterval: 30000,
  });
  const disponivel = lista.data != null && historico.data != null;
  const elegiveis = (lista.data ?? []).filter((p) => !motivoDoIntervalo(p.ultimo_aviso));
  const selecionados = elegiveis.filter((p) => !desmarcados.includes(p.id));
  const valido =
    titulo.trim().length > 0 &&
    texto.trim().length > 0 &&
    !/\{\{(?!(nome|credito|link)\}\})/.test(texto);
  function alterar() {
    setRascunho(null);
    setRecusados([]);
  }
  async function salvar(enviar: boolean) {
    setOcupado(true);
    try {
      const id = rascunho ?? (await salvarAviso(titulo, texto, publico));
      setRascunho(id);
      if (enviar) {
        const r = await enviarAviso(
          id,
          selecionados.map((p) => p.id),
        );
        setRecusados(r.recusados);
        toast.success(`${r.enviados.length} avisos colocados na fila.`);
        setTitulo("");
        setTexto("");
        setRascunho(null);
        setConfirmar(false);
        await qc.invalidateQueries({ queryKey: ["parceiro-aviso-publico"] });
      } else toast.success("Rascunho salvo.");
      await qc.invalidateQueries({ queryKey: ["parceiro-avisos-historico"] });
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível salvar ou enfileirar o aviso."));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="space-y-6">
      {(lista.isLoading || historico.isLoading) && (
        <p className="text-sm text-muted-foreground">Carregando avisos…</p>
      )}
      {(lista.error || historico.error) && (
        <p role="alert" className="text-sm text-destructive">
          {mensagemErro(lista.error ?? historico.error)}
        </p>
      )}
      {!lista.isLoading && lista.data === null && (
        <p role="status" className="border border-border p-3 text-sm text-muted-foreground">
          Avisos aguardam ativação autorizada. Nenhuma mensagem será enviada.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="aviso-titulo">Título interno</Label>
            <Input
              id="aviso-titulo"
              maxLength={200}
              value={titulo}
              onChange={(e) => {
                alterar();
                setTitulo(e.target.value);
              }}
              disabled={!podeEditar}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="aviso-texto">Mensagem</Label>
            <Textarea
              id="aviso-texto"
              rows={6}
              maxLength={4000}
              value={texto}
              onChange={(e) => {
                alterar();
                setTexto(e.target.value);
              }}
              disabled={!podeEditar}
            />
            <div className="flex flex-wrap gap-2">
              {["nome", "credito", "link"].map((v) => (
                <Button
                  key={v}
                  variant="outline"
                  size="sm"
                  disabled={!podeEditar}
                  onClick={() => {
                    alterar();
                    setTexto((t) => t + `{{${v}}}`);
                  }}
                >{`{{${v}}}`}</Button>
              ))}
            </div>
          </div>
          <Label htmlFor="aviso-publico">Público</Label>
          <Select
            value={publico}
            onValueChange={(v) => {
              alterar();
              setPublico(v as PublicoAviso);
              setDesmarcados([]);
            }}
          >
            <SelectTrigger id="aviso-publico" aria-label="Público do aviso">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(publicos).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="max-h-80 overflow-y-auto divide-y divide-border border-y border-border">
            {(lista.data ?? []).map((p) => {
              const motivo = motivoDoIntervalo(p.ultimo_aviso);
              return (
                <label key={p.id} className="flex items-center gap-3 py-3">
                  <Checkbox
                    aria-label={`Selecionar ${p.nome}`}
                    checked={!motivo && !desmarcados.includes(p.id)}
                    disabled={!!motivo || !podeEditar}
                    onCheckedChange={(v) =>
                      setDesmarcados((ids) =>
                        v ? ids.filter((id) => id !== p.id) : [...ids, p.id],
                      )
                    }
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block break-words">
                      {p.nome} · {p.telefone}
                    </span>
                    {motivo && <span className="text-muted-foreground">{motivo}</span>}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!disponivel || !podeEditar || !valido || ocupado}
              onClick={() => salvar(false)}
            >
              <Save className="mr-2 h-4 w-4" />
              Salvar rascunho
            </Button>
            <Button
              disabled={
                !disponivel ||
                !podeEditar ||
                !valido ||
                ocupado ||
                !quantidadePermitida(selecionados.map((p) => p.id))
              }
              onClick={() => setConfirmar(true)}
            >
              <Send className="mr-2 h-4 w-4" />
              Enviar para {selecionados.length} parceiros
            </Button>
          </div>
          {selecionados.length > 50 && (
            <p role="alert" className="text-sm text-destructive">
              Selecione no máximo 50 parceiros por aviso.
            </p>
          )}
          {recusados.map((r) => (
            <p key={r.parceiro_id} className="text-sm text-muted-foreground">
              {lista.data?.find((p) => p.id === r.parceiro_id)?.nome ?? r.parceiro_id}: {r.motivo}
            </p>
          ))}
        </section>
        <section className="space-y-3">
          <h3 className="font-semibold">
            Prévia{selecionados[0] ? ` · ${selecionados[0].nome}` : ""}
          </h3>
          <div className="min-h-48 whitespace-pre-wrap break-words border border-border bg-muted p-4 text-sm">
            {selecionados[0]
              ? montarTextoAviso(texto, selecionados[0])
              : "Nenhum destinatário selecionado."}
          </div>
        </section>
      </div>
      <section>
        <h3 className="mb-3 font-semibold">Histórico</h3>
        <div className="divide-y divide-border">
          {(historico.data ?? []).map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{a.titulo}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(a.created_at).toLocaleString("pt-BR")} · {a.status}
                </p>
              </div>
              <p className="text-sm">
                {a.sairam} saíram · {a.falharam} falharam · {a.na_fila} na fila · {a.cancelados}{" "}
                cancelados
              </p>
              {a.status === "rascunho" && podeEditar && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setTitulo(a.titulo);
                    setTexto(a.texto);
                    setPublico(a.publico);
                    setRascunho(a.id);
                    setDesmarcados([]);
                  }}
                >
                  Abrir rascunho
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>
      <Dialog open={confirmar} onOpenChange={(v) => !ocupado && setConfirmar(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar aviso</DialogTitle>
            <DialogDescription>
              Colocar na fila para {selecionados.length} parceiros cadastrados? O público será
              conferido novamente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={ocupado} onClick={() => setConfirmar(false)}>
              Cancelar
            </Button>
            <Button disabled={ocupado} onClick={() => salvar(true)}>
              {ocupado ? "Enfileirando…" : "Confirmar envio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
