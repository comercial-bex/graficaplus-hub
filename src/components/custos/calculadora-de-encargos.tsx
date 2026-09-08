import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PARCELAS,
  custoDaHora,
  parcelasDoRegime,
  somarEncargos,
} from "@/domain/financeiro/encargos";

/**
 * Calculadora de encargos: quanto custa de verdade a hora de uma pessoa.
 *
 * Ela NÃO escolhe a alíquota. Cada parcela do encargo fica marcável, com o nome
 * e a explicação ao lado, porque o total depende do regime tributário e de
 * decisões da casa. Um "70%" fixo escondido no código seria o mesmo erro do
 * custo/hora zerado — número que ninguém consegue conferir.
 *
 * Os dois botões de regime são atalho para marcar de uma vez, não trava: dá
 * para desmarcar qualquer parcela depois.
 */

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (n: number) => `${(n * 100).toFixed(2).replace(".", ",")}%`;

export function CalculadoraDeEncargos({
  onAplicar,
}: {
  /** devolve custo/hora e a fração de encargo para o formulário da função */
  onAplicar: (r: { custoHora: number; encargosPct: number }) => void;
}) {
  const [salario, setSalario] = useState("");
  const [horas, setHoras] = useState("220");
  const [marcadas, setMarcadas] = useState<string[]>(parcelasDoRegime("simples"));

  const encargos = somarEncargos(marcadas);
  const r = custoDaHora({
    salarioMensal: Number(salario.replace(",", ".")) || 0,
    horasMensais: horas === "" ? undefined : Number(horas),
    encargosPct: encargos,
  });

  const alternar = (chave: string) =>
    setMarcadas((a) => (a.includes(chave) ? a.filter((x) => x !== chave) : [...a, chave]));

  return (
    <div className="space-y-4 rounded-md border bg-muted/30 p-3">
      <div>
        <h4 className="text-sm font-semibold">Calcular do salário</h4>
        <p className="text-[11px] text-muted-foreground">
          As horas são as <strong>contratadas</strong> (220 na jornada de 44h), não as
          produtivas: o salário é pago por elas tenha a máquina rodado ou não.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Salário mensal</Label>
          <Input
            className="h-9 font-mono"
            type="number"
            step="0.01"
            placeholder="2500"
            value={salario}
            onChange={(e) => setSalario(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Horas por mês</Label>
          <Input
            className="h-9 font-mono"
            type="number"
            step="1"
            value={horas}
            onChange={(e) => setHoras(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setMarcadas(parcelasDoRegime("simples"))}>
          Simples Nacional
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setMarcadas(parcelasDoRegime("fora_do_simples"))}>
          Fora do Simples
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setMarcadas([])}>
          Limpar
        </Button>
      </div>

      <ul className="space-y-1">
        {PARCELAS.map((p) => (
          <li key={p.chave}>
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={marcadas.includes(p.chave)}
                onChange={() => alternar(p.chave)}
              />
              <span className="flex-1">
                <span className="font-medium">{p.rotulo}</span>
                <span className="font-mono text-muted-foreground"> · {pct(p.aliquota)}</span>
                <span className="block text-[11px] text-muted-foreground">{p.nota}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="rounded-md border bg-surface p-2.5 text-xs space-y-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Salário por hora</span>
          <span className="font-mono">{brl(r.salarioHora)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Encargos ({pct(encargos)})</span>
          <span className="font-mono">{brl(r.acrescimo)}</span>
        </div>
        <div className="flex justify-between font-semibold border-t pt-1">
          <span>Custo real da hora</span>
          <span className="font-mono">{brl(r.custoHora)}</span>
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        className="w-full"
        disabled={r.custoHora <= 0}
        onClick={() => onAplicar({ custoHora: r.salarioHora, encargosPct: encargos })}
      >
        Usar estes valores
      </Button>
      <p className="text-[11px] text-muted-foreground">
        O campo <em>Custo/h</em> recebe o salário-hora e o campo <em>Encargos</em> recebe a
        alíquota — o orçamento multiplica os dois. Guardar já multiplicado somaria o encargo
        duas vezes.
      </p>
    </div>
  );
}
