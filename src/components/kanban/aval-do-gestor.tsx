import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Factory, Hourglass, Megaphone, Percent, UserCog, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { itensDaRecusa } from "@/domain/os/etapas";
import { formatarData, paradaHa } from "@/domain/os/prazo";
import {
  ROTULO_DO_ASSUNTO,
  esperandoValidacaoSemPedido,
  filaDoGestor,
  type AssuntoDoGestor,
  type PedidoAoGestor,
} from "@/domain/os/fila-do-gestor";
import {
  equipeParaEscolher,
  papeisEmTexto,
  primeiroNome,
  type FuncaoNaOs,
  type PessoaDaProducao,
} from "@/domain/os/equipe-da-producao";

/**
 * O aval do gestor e a escolha de quem faz (14/11/2026, pedido do dono).
 *
 *  - ATENDIMENTO VALIDADO: o gestor confere o pacote, escolhe quem faz a criação e
 *    valida; a OS vai para a coluna "Atendimento validado" e o grupo da equipe recebe
 *    o aviso citando a pessoa. Quem não é gestor pede pelo grupo, citando o gestor —
 *    o que hoje é feito à mão no WhatsApp.
 *  - SALDO DEVEDOR: cliente que vai ficar devendo só produz com o aval do gestor,
 *    com o motivo registrado. MARGEM abaixo do mínimo, do mesmo jeito.
 *  - QUEM APROVA é só o gestor; o admin só acompanha (decisão do dono). Cada pedido
 *    ao gestor fica na fila (`os_pedidos_ao_gestor`), que o quadro mostra em
 *    "Esperando o gestor" — chega no aplicativo mesmo sem o grupo do WhatsApp.
 *  - OPERADOR: mandar para a fila de produção abre a escolha de quem produz.
 *
 * Tudo passa por funções do banco que conferem o papel de quem chama (a tela só
 * espelha): `validar_atendimento`, `autorizar_saldo_devedor`, `pedir_aval_do_gestor`,
 * `mandar_para_fila_de_producao` e `definir_operador_da_os`.
 */

type OsResumo = {
  id: string;
  numero?: number | null;
  designer_id?: string | null;
  operador_id?: string | null;
};

const CHAVES_DO_QUADRO = [
  ["kanban-os"],
  ["kanban-bloqueios"],
  ["painel-producao"],
  ["os-autorizacoes"],
  ["os-pedidos-ao-gestor"],
];

function useInvalidarQuadro() {
  const qc = useQueryClient();
  return () => {
    for (const chave of CHAVES_DO_QUADRO) void qc.invalidateQueries({ queryKey: chave });
  };
}

/** A recusa do banco em palavras: "Falta: A · B" quando é trava, a frase dele quando não é. */
function textoDaRecusa(e: unknown): string {
  const bruto = mensagemErro(e);
  const faltas = itensDaRecusa(bruto);
  return faltas ? `Falta: ${faltas.join(" · ")}` : bruto;
}

export function useEquipeDaProducao(ativo = true) {
  return useQuery({
    queryKey: ["equipe-da-producao"],
    enabled: ativo,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PessoaDaProducao[]> => {
      const { data, error } = await (supabase.rpc as any)("equipe_da_producao");
      if (error) throw error;
      return ((data ?? []) as PessoaDaProducao[]).map((p) => ({ ...p, papeis: p.papeis ?? [] }));
    },
  });
}

/* ------------------------------------------------------------------ *
 * Escolher a pessoa
 * ------------------------------------------------------------------ */

function EscolherPessoa({
  funcao,
  valor,
  onValor,
  rotulo,
}: {
  funcao: FuncaoNaOs;
  valor: string;
  onValor: (id: string) => void;
  rotulo: string;
}) {
  const equipe = useEquipeDaProducao();
  if (equipe.isPending) return <p className="text-sm text-muted-foreground">Carregando a equipe…</p>;
  if (equipe.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Não foi possível carregar a equipe: {mensagemErro(equipe.error)}
      </p>
    );
  }
  const { sugeridos, outros } = equipeParaEscolher(equipe.data ?? [], funcao);
  const grupos = [
    { titulo: funcao === "criacao" ? "Da criação" : "Operadores", pessoas: sugeridos },
    { titulo: sugeridos.length > 0 ? "Outras pessoas da equipe" : "Equipe", pessoas: outros },
  ].filter((g) => g.pessoas.length > 0);

  return (
    <RadioGroup value={valor} onValueChange={onValor} aria-label={rotulo} className="gap-3">
      {grupos.map((g) => (
        <div key={g.titulo} className="space-y-1.5">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">{g.titulo}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {g.pessoas.map((p) => {
              const id = `pessoa-${funcao}-${p.id}`;
              return (
                <Label
                  key={p.id}
                  htmlFor={id}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm font-normal transition-colors",
                    valor === p.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50",
                  )}
                >
                  <RadioGroupItem id={id} value={p.id} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{p.nome ?? "Sem nome"}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {papeisEmTexto(p.papeis) || "Equipe"}
                      {!p.tem_whatsapp && " · sem celular: o grupo não cita"}
                    </span>
                  </span>
                </Label>
              );
            })}
          </div>
        </div>
      ))}
    </RadioGroup>
  );
}

/* ------------------------------------------------------------------ *
 * Atendimento validado
 * ------------------------------------------------------------------ */

export function ValidarAtendimento({ os, rotulo = "Validar atendimento" }: { os: OsResumo; rotulo?: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button type="button" size="sm" onClick={() => setAberto(true)}>
        <BadgeCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {rotulo}
      </Button>
      <ValidarAtendimentoDialog os={os} aberto={aberto} onAberto={setAberto} />
    </>
  );
}

export function ValidarAtendimentoDialog({
  os,
  aberto,
  onAberto,
}: {
  os: OsResumo;
  aberto: boolean;
  onAberto: (aberto: boolean) => void;
}) {
  const invalidar = useInvalidarQuadro();
  const equipe = useEquipeDaProducao(aberto);
  const [designer, setDesigner] = useState(os.designer_id ?? "");
  const [observacao, setObservacao] = useState("");
  const [recusa, setRecusa] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setDesigner(os.designer_id ?? "");
    setObservacao("");
    setRecusa(null);
  }, [aberto, os.id, os.designer_id]);

  const validar = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as any)("validar_atendimento", {
        p_os_id: os.id,
        p_designer_id: designer,
        p_motivo: observacao.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      const nome = primeiroNome(equipe.data?.find((p) => p.id === designer)?.nome);
      toast.success(`Atendimento validado: a criação da OS #${os.numero ?? ""} é com ${nome}.`, {
        description: "A OS foi para “Atendimento validado” e o grupo da equipe recebeu o aviso.",
      });
      invalidar();
      onAberto(false);
    },
    onError: (e) => setRecusa(textoDaRecusa(e)),
  });

  return (
    <Dialog open={aberto} onOpenChange={onAberto}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Validar o atendimento · OS #{os.numero ?? ""}</DialogTitle>
          <DialogDescription>
            Conferiu o pacote (pedido, arquivos, prazo e pagamento)? Escolha quem faz a criação. A OS vai para
            “Atendimento validado” e o grupo da equipe recebe o aviso, citando a pessoa.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Quem faz a criação?</p>
            <EscolherPessoa funcao="criacao" valor={designer} onValor={setDesigner} rotulo="Quem faz a criação" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`obs-validacao-${os.id}`}>Recado para a criação (opcional)</Label>
            <Textarea
              id={`obs-validacao-${os.id}`}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex.: usar a logo nova que o cliente mandou no WhatsApp"
              rows={2}
            />
          </div>
          {recusa && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {recusa}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onAberto(false)}>
            Voltar
          </Button>
          <Button type="button" disabled={!designer || validar.isPending} onClick={() => validar.mutate()}>
            {validar.isPending ? "Validando…" : "Validar e passar para a criação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Quem não é gestor pede o aval pelo grupo da equipe, citando o gestor. */
export function PedirAoGestor({
  osId,
  assunto,
  rotulo = "Pedir ao gestor no grupo",
}: {
  osId: string;
  assunto: AssuntoDoGestor;
  rotulo?: string;
}) {
  const invalidar = useInvalidarQuadro();
  const pedir = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("pedir_aval_do_gestor", {
        p_os_id: osId,
        p_assunto: assunto,
      });
      if (error) throw error;
      return data as { novo_aviso?: boolean; gestores_citados?: number; grupo_ligado?: boolean } | null;
    },
    onSuccess: (r) => {
      invalidar();
      if (r && r.grupo_ligado === false) {
        toast.success("Pedido registrado: aparece para o gestor no quadro, em “Esperando o gestor”.", {
          description: "O aviso no grupo da equipe está desligado (WhatsApp › Configurações).",
        });
      } else if (r && r.novo_aviso === false) {
        toast.info("Você já pediu há pouco: o aviso está na fila do grupo da equipe.");
      } else if ((r?.gestores_citados ?? 0) === 0) {
        toast.warning("Pedido enviado ao grupo da equipe, mas nenhum gestor tem celular no cadastro para ser citado.");
      } else {
        toast.success("Pedido enviado ao grupo da equipe, citando o gestor.");
      }
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <Button type="button" size="sm" variant="outline" disabled={pedir.isPending} onClick={() => pedir.mutate()}>
      <Megaphone className="mr-1.5 h-3.5 w-3.5" aria-hidden />
      {pedir.isPending ? "Enviando…" : rotulo}
    </Button>
  );
}

/* ------------------------------------------------------------------ *
 * Saldo devedor
 * ------------------------------------------------------------------ */

const AUTORIZACAO = {
  saldo_devedor: {
    rpc: "autorizar_saldo_devedor",
    botao: "Autorizar a ficar devendo",
    pergunta: "Por que o cliente pode ficar devendo?",
    exemplo: "Ex.: cliente antigo, paga na retirada",
    feito: "Autorizado: esta OS produz com o cliente devendo.",
    Icone: Wallet,
  },
  margem_baixa: {
    rpc: "autorizar_margem_baixa",
    botao: "Liberar a margem",
    pergunta: "Por que a margem pode ficar abaixo do mínimo?",
    exemplo: "Ex.: cliente grande, volume alto, parceria",
    feito: "Margem liberada para esta OS.",
    Icone: Percent,
  },
} as const;

/** O aval do gestor com motivo: cliente devendo ou margem abaixo do mínimo. */
function AutorizarComMotivo({ osId, tipo }: { osId: string; tipo: keyof typeof AUTORIZACAO }) {
  const invalidar = useInvalidarQuadro();
  const [abrindo, setAbrindo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const cfg = AUTORIZACAO[tipo];
  const autorizar = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as any)(cfg.rpc, { p_os_id: osId, p_motivo: motivo.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(cfg.feito, { description: "O motivo ficou registrado e o grupo da equipe recebeu o aviso." });
      setAbrindo(false);
      setMotivo("");
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (!abrindo) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setAbrindo(true)}>
        <cfg.Icone className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {cfg.botao}
      </Button>
    );
  }
  const curto = motivo.trim().length < 5;
  const id = `motivo-${tipo}-${osId}`;
  return (
    <div className="space-y-2 rounded-md border border-border bg-background/60 p-2.5">
      <Label htmlFor={id} className="text-xs">
        {cfg.pergunta}
      </Label>
      <Textarea id={id} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={cfg.exemplo} rows={2} autoFocus />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={curto || autorizar.isPending} onClick={() => autorizar.mutate()}>
          {autorizar.isPending ? "Autorizando…" : "Autorizar"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAbrindo(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/** Saldo devedor: `autorizar_saldo_devedor`. */
export function AutorizarSaldoDevedor({ osId }: { osId: string }) {
  return <AutorizarComMotivo osId={osId} tipo="saldo_devedor" />;
}

/** Margem abaixo do mínimo: `autorizar_margem_baixa`. */
export function AutorizarMargemBaixa({ osId }: { osId: string }) {
  return <AutorizarComMotivo osId={osId} tipo="margem_baixa" />;
}

/* ------------------------------------------------------------------ *
 * Operador
 * ------------------------------------------------------------------ */

/**
 * Mandar para a fila de produção escolhendo quem produz — "dentro de um modal, eu
 * seleciono o operador, o Fernando, para seguir para ele". O operador e a mudança de
 * etapa vão juntos: se uma trava barrar, nada fica gravado e a recusa aparece aqui.
 * Com `trocar`, só troca o operador de quem já está na fila ou na máquina.
 */
export function EscolherOperadorDialog({
  os,
  aberto,
  onAberto,
  trocar = false,
}: {
  os: OsResumo;
  aberto: boolean;
  onAberto: (aberto: boolean) => void;
  trocar?: boolean;
}) {
  const invalidar = useInvalidarQuadro();
  const equipe = useEquipeDaProducao(aberto);
  const [operador, setOperador] = useState(os.operador_id ?? "");
  const [recusa, setRecusa] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setOperador(os.operador_id ?? "");
    setRecusa(null);
  }, [aberto, os.id, os.operador_id]);

  const nome = primeiroNome(equipe.data?.find((p) => p.id === operador)?.nome);
  const mandar = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as any)(
        trocar ? "definir_operador_da_os" : "mandar_para_fila_de_producao",
        { p_os_id: os.id, p_operador_id: operador },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        trocar ? `Operador trocado: a OS #${os.numero ?? ""} agora é com ${nome}.` : `OS #${os.numero ?? ""} na fila de produção com ${nome}.`,
        { description: "O grupo da equipe recebeu o aviso, citando o operador." },
      );
      invalidar();
      onAberto(false);
    },
    onError: (e) => setRecusa(textoDaRecusa(e)),
  });

  return (
    <Dialog open={aberto} onOpenChange={onAberto}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {trocar ? "Trocar o operador" : "Mandar para a fila de produção"} · OS #{os.numero ?? ""}
          </DialogTitle>
          <DialogDescription>
            Quem vai produzir? A OS aparece para essa pessoa em “Minha oficina”, e o grupo da equipe recebe o aviso.
            Quando ficar pronta, volta para o atendimento combinar a entrega.
          </DialogDescription>
        </DialogHeader>
        <EscolherPessoa funcao="operador" valor={operador} onValor={setOperador} rotulo="Quem vai produzir" />
        {recusa && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {trocar ? recusa : `Ainda não vai para a fila. ${recusa}`}
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onAberto(false)}>
            Voltar
          </Button>
          <Button type="button" disabled={!operador || mandar.isPending} onClick={() => mandar.mutate()}>
            <Factory className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {mandar.isPending ? "Enviando…" : operador ? `Mandar para ${nome}` : "Escolha o operador"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TrocarOperador({ os }: { os: OsResumo }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => setAberto(true)}>
        <UserCog className="mr-1 h-3.5 w-3.5" aria-hidden />
        {os.operador_id ? "Trocar operador" : "Escolher operador"}
      </Button>
      <EscolherOperadorDialog os={os} aberto={aberto} onAberto={setAberto} trocar />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * O que o gestor já autorizou
 * ------------------------------------------------------------------ */

type Autorizacao = {
  id: string;
  tipo: "atendimento_validado" | "saldo_devedor" | "margem_baixa";
  autorizado_por: string;
  autorizado_em: string;
  motivo: string | null;
  designer_id: string | null;
};

/** As autorizações da OS, com quem deu e quando — sem o valor em aberto (coluna fechada ao navegador). */
export function AutorizacoesDaOs({ osId }: { osId: string }) {
  const equipe = useEquipeDaProducao();
  const lista = useQuery({
    queryKey: ["os-autorizacoes", osId],
    staleTime: 60_000,
    queryFn: async (): Promise<Autorizacao[]> => {
      const { data, error } = await (supabase as any)
        .from("os_autorizacoes")
        .select("id, tipo, autorizado_por, autorizado_em, motivo, designer_id")
        .eq("os_id", osId)
        .order("autorizado_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Autorizacao[];
    },
  });
  // A tabela nasce com a migração: antes de ela existir, a ficha segue sem este bloco.
  if (lista.isError || !lista.data || lista.data.length === 0) return null;
  const nome = (id: string | null) => primeiroNome(equipe.data?.find((p) => p.id === id)?.nome ?? null);
  return (
    <ul className="space-y-1 text-xs text-muted-foreground" aria-label="Autorizações do gestor">
      {lista.data.map((a) => (
        <li key={a.id} className="flex items-start gap-1.5">
          <BadgeCheck className="mt-px h-3.5 w-3.5 shrink-0 text-[color:var(--status-positive)]" aria-hidden />
          <span>
            {a.tipo === "atendimento_validado" ? (
              <>
                Atendimento validado por <span className="font-medium text-foreground/85">{nome(a.autorizado_por)}</span> em{" "}
                {formatarData(a.autorizado_em)}
                {a.designer_id && (
                  <>
                    {" "}
                    · criação com <span className="font-medium text-foreground/85">{nome(a.designer_id)}</span>
                  </>
                )}
              </>
            ) : a.tipo === "margem_baixa" ? (
              <>
                Margem liberada por <span className="font-medium text-foreground/85">{nome(a.autorizado_por)}</span> em{" "}
                {formatarData(a.autorizado_em)}
              </>
            ) : (
              <>
                Pode produzir devendo · autorizado por{" "}
                <span className="font-medium text-foreground/85">{nome(a.autorizado_por)}</span> em {formatarData(a.autorizado_em)}
              </>
            )}
            {a.motivo && <span className="italic"> · “{a.motivo}”</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Esperando o gestor
 * ------------------------------------------------------------------ */

/** Os pedidos abertos ao gestor — uma consulta só, que o quadro, a faixa e os cartões dividem. */
export function usePedidosAoGestor() {
  return useQuery({
    queryKey: ["os-pedidos-ao-gestor"],
    staleTime: 30_000,
    queryFn: async (): Promise<PedidoAoGestor[]> => {
      const { data, error } = await (supabase as any)
        .from("os_pedidos_ao_gestor")
        .select("id, os_id, assunto, pedido_por, pedido_em")
        .is("resolvido_em", null)
        .order("pedido_em", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PedidoAoGestor[];
    },
  });
}

type OsDoQuadro = OsResumo & { titulo?: string | null; cliente_nome?: string | null };

/**
 * A fila do gestor, no topo do quadro (14/11/2026): o que pediram a ele (quem pediu,
 * quando, o quê) e quantas OS do Atendimento esperam validação sem pedido. Só aparece
 * pedido cuja trava continua (a entrada paga ou o preço revisto tiram o pedido da fila).
 * O gestor resolve dali mesmo; os outros veem o que está parado no gestor.
 */
export function EsperandoOGestor({
  os,
  travas,
  gestor,
  onAbrirFicha,
  onValidar,
}: {
  os: readonly OsDoQuadro[];
  travas: ReadonlyMap<string, readonly { codigo: string }[]>;
  gestor: boolean;
  onAbrirFicha: (osId: string) => void;
  onValidar: (os: OsDoQuadro) => void;
}) {
  const equipe = useEquipeDaProducao();
  const pedidos = usePedidosAoGestor();
  // Sem a tabela (antes da migração) ou com a consulta caída: o quadro segue sem a faixa.
  const porId = new Map(os.map((o) => [o.id, o]));
  const fila = filaDoGestor(pedidos.data ?? [], travas).filter((p) => porId.has(p.os_id));
  const semPedido = esperandoValidacaoSemPedido(pedidos.data ?? [], travas).filter((id) => porId.has(id));
  if (pedidos.isError || (fila.length === 0 && (!gestor || semPedido.length === 0))) return null;

  const nome = (id: string) => primeiroNome(equipe.data?.find((p) => p.id === id)?.nome ?? null);
  const quando = (em: string) => {
    const ha = paradaHa(em);
    return ha === "agora" ? "agora há pouco" : ha ? `há ${ha}` : "";
  };

  return (
    <details
      open={gestor}
      className="rounded-lg border border-[color:var(--bex-amber)]/40 bg-[color:var(--bex-amber)]/10 px-3 py-2"
    >
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <Hourglass className="h-4 w-4 shrink-0 text-[color:var(--bex-amber)]" aria-hidden />
        {gestor ? "Esperando você (gestor)" : "Esperando o gestor"}
        <span className="font-mono text-xs text-muted-foreground">
          {fila.length} {fila.length === 1 ? "pedido" : "pedidos"}
          {gestor && semPedido.length > 0 && ` · ${semPedido.length} no Atendimento sem validar`}
        </span>
      </summary>
      {fila.length > 0 && (
        <ul className="mt-2 space-y-1.5" aria-label="Pedidos ao gestor">
          {fila.map((p) => {
            const o = porId.get(p.os_id)!;
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-md bg-background/70 px-2.5 py-1.5 text-xs">
                <span className="font-mono text-muted-foreground">#{o.numero ?? "—"}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-foreground">{ROTULO_DO_ASSUNTO[p.assunto]}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {o.cliente_nome ?? o.titulo ?? "OS"} · pedido por {nome(p.pedido_por)} {quando(p.pedido_em)}
                  </span>
                </span>
                {gestor && p.assunto === "atendimento" ? (
                  <Button type="button" size="sm" className="h-8" onClick={() => onValidar(o)}>
                    Validar
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => onAbrirFicha(o.id)}>
                    {gestor ? "Resolver" : "Ver"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {gestor && semPedido.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {semPedido.length === 1 ? "1 OS" : `${semPedido.length} OS`} no Atendimento ainda sem validação e sem pedido (
          {semPedido
            .slice(0, 6)
            .map((id) => `#${porId.get(id)?.numero ?? "—"}`)
            .join(", ")}
          {semPedido.length > 6 && "…"}). Abra o cartão para validar.
        </p>
      )}
    </details>
  );
}
