import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { origensParaOferecer } from "@/domain/crm/origens";
import { formatarTelefone, apenasDigitos } from "@/domain/documentos";
import {
  OPCOES_DE_INSCRICAO_ESTADUAL,
  inscricaoEstadualHabilitada,
  emailValido,
  type CamposDaFicha,
} from "@/domain/clientes/ficha-do-cliente";

/**
 * Campos da ficha do cliente no desenho do Holdprint (01/11/2026): "Documentos" (inscrição
 * municipal e estadual), "Canais de contato" e "Origem do cliente". Servem ao cadastro novo e
 * à edição; quem usa guarda o estado e recebe só a mudança, para juntar com o resto do formulário.
 */

type Texto = string | null | undefined;
type Mudanca = (parcial: Partial<CamposDaFicha>) => void;

/** Bloco que abre e fecha, para o cadastro continuar curto. O resumo é grande de propósito. */
export function SecaoRecolhivel({
  titulo,
  dica,
  abertaDeInicio = false,
  children,
}: {
  titulo: string;
  dica?: string;
  abertaDeInicio?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={abertaDeInicio} className="group rounded-md border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span>
          <span className="block text-base font-semibold text-foreground">{titulo}</span>
          {dica && <span className="block text-sm text-muted-foreground">{dica}</span>}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}

export function CamposDeInscricao({
  valor,
  onChange,
}: {
  valor: {
    possui_inscricao_estadual?: Texto;
    inscricao_estadual?: Texto;
    inscricao_municipal?: Texto;
  };
  onChange: Mudanca;
}) {
  const possui = valor.possui_inscricao_estadual || "nao_informado";
  const habilitada = inscricaoEstadualHabilitada(possui);
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="space-y-2">
        <Label htmlFor="inscricao-municipal">Inscrição municipal</Label>
        <Input
          id="inscricao-municipal"
          maxLength={30}
          value={valor.inscricao_municipal ?? ""}
          onChange={(e) => onChange({ inscricao_municipal: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="possui-inscricao-estadual">Possui inscrição estadual</Label>
        <Select
          value={possui}
          onValueChange={(v) =>
            onChange({
              possui_inscricao_estadual: v,
              // O número só existe para quem é contribuinte; trocar a resposta limpa o resto.
              ...(inscricaoEstadualHabilitada(v) ? {} : { inscricao_estadual: "" }),
            })
          }
        >
          <SelectTrigger id="possui-inscricao-estadual">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPCOES_DE_INSCRICAO_ESTADUAL.map((o) => (
              <SelectItem key={o.valor} value={o.valor}>
                {o.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="inscricao-estadual">Inscrição estadual</Label>
        <Input
          id="inscricao-estadual"
          maxLength={30}
          disabled={!habilitada}
          placeholder={habilitada ? "Número da inscrição" : "Escolha “Sim” ao lado"}
          value={habilitada ? (valor.inscricao_estadual ?? "") : ""}
          onChange={(e) => onChange({ inscricao_estadual: e.target.value })}
        />
      </div>
    </div>
  );
}

function CampoDeTelefone({
  id,
  rotulo,
  valor,
  onChange,
}: {
  id: string;
  rotulo: string;
  valor: Texto;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{rotulo}</Label>
      <Input
        id={id}
        inputMode="tel"
        maxLength={20}
        placeholder="(96) 99999-9999"
        value={valor ?? ""}
        onChange={(e) => onChange(e.target.value)}
        // Máscara na saída do campo, não a cada tecla: a cada tecla o cursor pula.
        onBlur={(e) => {
          const n = apenasDigitos(e.target.value).length;
          if (n === 10 || n === 11) onChange(formatarTelefone(e.target.value));
        }}
      />
    </div>
  );
}

function CampoDeEmail({
  id,
  rotulo,
  valor,
  onChange,
}: {
  id: string;
  rotulo: string;
  valor: Texto;
  onChange: (v: string) => void;
}) {
  const invalido = !emailValido(valor);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{rotulo}</Label>
      <Input
        id={id}
        type="email"
        maxLength={150}
        value={valor ?? ""}
        aria-invalid={invalido}
        onChange={(e) => onChange(e.target.value)}
      />
      {invalido && <p className="text-sm text-destructive">Confira o e-mail: parece incompleto.</p>}
    </div>
  );
}

export function CamposDeCanais({
  valor,
  onChange,
}: {
  valor: {
    telefone_2?: Texto;
    telefone_3?: Texto;
    email_nota_fiscal?: Texto;
    email_boleto?: Texto;
    site?: Texto;
  };
  onChange: Mudanca;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <CampoDeTelefone
        id="telefone-2"
        rotulo="Telefone 2"
        valor={valor.telefone_2}
        onChange={(v) => onChange({ telefone_2: v })}
      />
      <CampoDeTelefone
        id="telefone-3"
        rotulo="Telefone 3"
        valor={valor.telefone_3}
        onChange={(v) => onChange({ telefone_3: v })}
      />
      <CampoDeEmail
        id="email-nota-fiscal"
        rotulo="E-mail para envio de nota fiscal"
        valor={valor.email_nota_fiscal}
        onChange={(v) => onChange({ email_nota_fiscal: v })}
      />
      <CampoDeEmail
        id="email-boleto"
        rotulo="E-mail para envio de boleto"
        valor={valor.email_boleto}
        onChange={(v) => onChange({ email_boleto: v })}
      />
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="site-do-cliente">Site</Label>
        <Input
          id="site-do-cliente"
          maxLength={200}
          placeholder="www.exemplo.com.br"
          value={valor.site ?? ""}
          onChange={(e) => onChange({ site: e.target.value })}
        />
      </div>
    </div>
  );
}

/** "Origem do cliente": a lista do Leads, mais o que o sistema já tenha gravado fora dela. */
export function CampoDeOrigem({
  valor,
  onChange,
}: {
  valor: Texto;
  onChange: (origem: string) => void;
}) {
  const atual = (valor ?? "").trim();
  return (
    <div className="space-y-2">
      <Label htmlFor="origem-do-cliente">Origem do cliente</Label>
      <Select value={atual || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
        <SelectTrigger id="origem-do-cliente">
          <SelectValue placeholder="De onde veio?" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Não informada</SelectItem>
          {origensParaOferecer(atual).map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground">
        Mostra de onde vêm os clientes e onde vale gastar em divulgação.
      </p>
    </div>
  );
}
