import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  salvarFeriadoDaTriagem,
  salvarHorarioDoDia,
  type DiaDaTela,
  type FeriadoDaTela,
  type FeriadoParaSalvar,
  type PainelDaTriagem,
} from "@/lib/api/whatsapp-triagem.functions";
import { dataEmIso, dataEmTexto, NOME_DO_DIA } from "@/domain/whatsapp/triagem/tela";
import { BOTAO, CAMPO, ErroDeGravacao } from "./comum";

/**
 * O horário de atendimento presencial e os feriados. É a fonte única: o robô de
 * boas-vindas e a assistente leem a mesma função do banco, então o horário que a
 * pessoa lê na despedida é este.
 */
export function HorariosEFeriados({
  painel,
  aoMudar,
}: {
  painel: PainelDaTriagem;
  aoMudar: () => void;
}) {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-xl">Horário de atendimento e feriados</CardTitle>
        <p className="text-base text-foreground">
          O robô usa o horário de Belém. Fora do horário ele diz a hora em que a loja abre e avisa
          que a equipe responde depois. Dia desligado é dia fechado.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <ul className="space-y-3">
          {painel.horarios.map((h) => (
            <LinhaDoDia
              key={`${h.dia_semana}-${h.abre}-${h.fecha}-${h.ativo}`}
              dia={h}
              aoMudar={aoMudar}
            />
          ))}
        </ul>
        <Feriados feriados={painel.feriados} aoMudar={aoMudar} />
      </CardContent>
    </Card>
  );
}

function LinhaDoDia({ dia, aoMudar }: { dia: DiaDaTela; aoMudar: () => void }) {
  const [ativo, setAtivo] = useState(dia.ativo);
  const [abre, setAbre] = useState(dia.abre);
  const [fecha, setFecha] = useState(dia.fecha);
  const [erro, setErro] = useState<string | null>(null);
  const gravar = useServerFn(salvarHorarioDoDia);
  const salvar = useMutation({
    mutationFn: () => gravar({ data: { dia: dia.dia_semana, abre, fecha, ativo } }),
    onSuccess: () => {
      setErro(null);
      toast.success(`${NOME_DO_DIA[dia.dia_semana]} salvo.`);
      aoMudar();
    },
    onError: (e) => setErro(mensagemErro(e, "Não foi possível salvar o horário.")),
  });
  const mudou = ativo !== dia.ativo || abre !== dia.abre || fecha !== dia.fecha;
  const horaCerta = fecha > abre;
  const id = `dia-${dia.dia_semana}`;
  return (
    <li className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-24 text-base font-semibold text-foreground">
          {NOME_DO_DIA[dia.dia_semana]}
        </span>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-base text-foreground">
          <input
            type="checkbox"
            className="h-6 w-6 shrink-0 cursor-pointer accent-[var(--link)]"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
          />
          Atende
        </label>
        <Label htmlFor={`${id}-abre`} className="text-base text-foreground">
          Abre
        </Label>
        <Input
          id={`${id}-abre`}
          type="time"
          className={cn(CAMPO, "w-36")}
          value={abre}
          onChange={(e) => setAbre(e.target.value)}
        />
        <Label htmlFor={`${id}-fecha`} className="text-base text-foreground">
          Fecha
        </Label>
        <Input
          id={`${id}-fecha`}
          type="time"
          className={cn(CAMPO, "w-36")}
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
        />
        <Button
          type="button"
          className={BOTAO}
          disabled={!mudou || !horaCerta || salvar.isPending}
          onClick={() => salvar.mutate()}
        >
          Salvar
        </Button>
      </div>
      {!horaCerta ? (
        <p className="text-base text-foreground">
          A hora de fechar precisa ser depois da hora de abrir.
        </p>
      ) : null}
      <ErroDeGravacao mensagem={erro} />
    </li>
  );
}

function Feriados({ feriados, aoMudar }: { feriados: FeriadoDaTela[]; aoMudar: () => void }) {
  const [data, setData] = useState("");
  const [nome, setNome] = useState("");
  const [fechado, setFechado] = useState(true);
  const [abre, setAbre] = useState("08:00");
  const [fecha, setFecha] = useState("12:00");
  const [erro, setErro] = useState<string | null>(null);
  const gravar = useServerFn(salvarFeriadoDaTriagem);
  const salvar = useMutation({
    mutationFn: (v: FeriadoParaSalvar) => gravar({ data: v }),
    onSuccess: () => aoMudar(),
  });
  const iso = dataEmIso(data);

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h3 className="text-base font-semibold text-foreground">Feriados</h3>
      {feriados.length === 0 ? (
        <p className="text-base text-foreground">Nenhum feriado cadastrado.</p>
      ) : (
        <ul className="space-y-2">
          {feriados.map((f) => (
            <li
              key={f.data}
              className="flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <span className="text-base text-foreground">
                <strong>{dataEmTexto(f.data)}</strong> {f.nome}.{" "}
                {f.fechado ? "Fechado." : `Atende das ${f.abre} às ${f.fecha}.`}
              </span>
              <Button
                type="button"
                variant="outline"
                className={BOTAO}
                disabled={salvar.isPending}
                aria-label={`Tirar o feriado ${f.nome}`}
                onClick={() => {
                  setErro(null);
                  salvar.mutate(
                    {
                      data: f.data,
                      nome: f.nome,
                      fechado: f.fechado,
                      abre: f.abre,
                      fecha: f.fecha,
                      remover: true,
                    },
                    {
                      onSuccess: () => toast.success("Feriado tirado."),
                      onError: (e) => setErro(mensagemErro(e, "Não foi possível tirar o feriado.")),
                    },
                  );
                }}
              >
                <Trash2 className="h-5 w-5" aria-hidden="true" /> Tirar
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="feriado-data" className="text-base text-foreground">
            Data, no formato dia/mês/ano
          </Label>
          <Input
            id="feriado-data"
            className={CAMPO}
            placeholder="25/12/2026"
            value={data}
            onChange={(e) => setData(e.target.value.slice(0, 10))}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="feriado-nome" className="text-base text-foreground">
            Nome
          </Label>
          <Input
            id="feriado-nome"
            className={CAMPO}
            placeholder="Natal"
            value={nome}
            onChange={(e) => setNome(e.target.value.slice(0, 80))}
          />
        </div>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base text-foreground">
        <input
          type="checkbox"
          className="h-6 w-6 shrink-0 cursor-pointer accent-[var(--link)]"
          checked={fechado}
          onChange={(e) => setFechado(e.target.checked)}
        />
        A loja fica fechada neste dia
      </label>
      {!fechado ? (
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="feriado-abre" className="text-base text-foreground">
            Abre
          </Label>
          <Input
            id="feriado-abre"
            type="time"
            className={cn(CAMPO, "w-36")}
            value={abre}
            onChange={(e) => setAbre(e.target.value)}
          />
          <Label htmlFor="feriado-fecha" className="text-base text-foreground">
            Fecha
          </Label>
          <Input
            id="feriado-fecha"
            type="time"
            className={cn(CAMPO, "w-36")}
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>
      ) : null}
      {data.trim() !== "" && !iso ? (
        <p className="text-base text-foreground">Essa data não existe. Use dia/mês/ano.</p>
      ) : null}
      <ErroDeGravacao mensagem={erro} />
      <Button
        type="button"
        className={BOTAO}
        disabled={!iso || !nome.trim() || salvar.isPending || (!fechado && fecha <= abre)}
        onClick={() => {
          if (!iso) return;
          setErro(null);
          salvar.mutate(
            {
              data: iso,
              nome: nome.trim(),
              fechado,
              abre: fechado ? null : abre,
              fecha: fechado ? null : fecha,
              remover: false,
            },
            {
              onSuccess: () => {
                toast.success("Feriado salvo.");
                setData("");
                setNome("");
              },
              onError: (e) => setErro(mensagemErro(e, "Não foi possível salvar o feriado.")),
            },
          );
        }}
      >
        <Plus className="h-5 w-5" aria-hidden="true" /> Salvar feriado
      </Button>
    </section>
  );
}
