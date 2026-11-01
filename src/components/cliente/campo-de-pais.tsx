import { useEffect, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  PAISES,
  PAISES_FREQUENTES,
  bandeira,
  ehBrasil,
  montarTelefoneInternacional,
  paisPorCodigo,
  separarTelefoneInternacional,
} from "@/domain/clientes/paises";

/**
 * País e telefone do cliente (01/11/2026), como no Holdprint: a lista mostra a bandeira e o nome
 * do país, e o WhatsApp de cliente de fora tem o código de discagem para escolher.
 */

const semAcento = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Busca por nome, código ISO ou DDI, sem ligar para acento ("guiana", "594", "gf"). */
const filtrar = (valor: string, busca: string) => (semAcento(valor).includes(semAcento(busca.trim())) ? 1 : 0);

function ListaDePaises({
  marcado,
  aoEscolher,
  porDdi = false,
}: {
  marcado: string;
  aoEscolher: (codigo: string, ddi: string) => void;
  /** Na lista de códigos de discagem o que fica marcado é o DDI, não o país. */
  porDdi?: boolean;
}) {
  const frequentes = PAISES.filter((p) => PAISES_FREQUENTES.includes(p.codigo));
  const outros = PAISES.filter((p) => !PAISES_FREQUENTES.includes(p.codigo));
  const item = (p: (typeof PAISES)[number]) => {
    const ativo = porDdi ? p.ddi === marcado : p.codigo === marcado;
    return (
      <CommandItem
        key={p.codigo}
        value={`${p.nome} ${p.codigo} ${p.ddi}`}
        onSelect={() => aoEscolher(p.codigo, p.ddi)}
        className="min-h-11 gap-2 text-base"
      >
        <span aria-hidden="true" className="w-7 text-xl leading-none">
          {bandeira(p.codigo)}
        </span>
        <span className="flex-1">{p.nome}</span>
        <span className="tabular-nums text-muted-foreground">+{p.ddi}</span>
        <Check aria-hidden="true" className={cn("h-4 w-4", ativo ? "opacity-100" : "opacity-0")} />
      </CommandItem>
    );
  };
  return (
    <Command filter={filtrar}>
      <CommandInput placeholder="Buscar país ou código" />
      <CommandList className="max-h-72">
        <CommandEmpty>Nenhum país encontrado.</CommandEmpty>
        <CommandGroup heading="Mais usados">{frequentes.map(item)}</CommandGroup>
        <CommandGroup heading="Todos os países">{outros.map(item)}</CommandGroup>
      </CommandList>
    </Command>
  );
}

export function SeletorDePais({
  valor,
  onChange,
  id = "pais-do-cliente",
  rotulo = "País",
}: {
  valor: string | null | undefined;
  onChange: (codigo: string) => void;
  id?: string;
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const pais = paisPorCodigo(valor) ?? paisPorCodigo("BR")!;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{rotulo}</Label>
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={aberto}
            className="h-11 w-full justify-between gap-2 px-3 text-base font-normal"
          >
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="text-xl leading-none">
                {bandeira(pais.codigo)}
              </span>
              {pais.nome}
            </span>
            <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0" align="start">
          <ListaDePaises
            marcado={pais.codigo}
            aoEscolher={(codigo) => {
              onChange(codigo);
              setAberto(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** O código de discagem, com a bandeira do primeiro país que o usa. */
function SeletorDeDdi({ ddi, aoEscolher }: { ddi: string; aoEscolher: (ddi: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const dono = PAISES.find((p) => p.ddi === ddi);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={aberto}
          aria-label="Código do país do telefone"
          className="h-11 shrink-0 gap-1.5 px-3 text-base font-normal"
        >
          <span aria-hidden="true" className="text-xl leading-none">
            {dono ? bandeira(dono.codigo) : "🌐"}
          </span>
          <span className="tabular-nums">+{ddi || "?"}</span>
          <ChevronsUpDown aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <ListaDePaises
          marcado={ddi}
          porDdi
          aoEscolher={(_codigo, novo) => {
            aoEscolher(novo);
            setAberto(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * O WhatsApp do cliente. Do Brasil, o campo de sempre (celular com DDD). De fora, o código do
 * país para escolher e o número como se usa lá; o que vai para o cadastro é "+594 694 12 34 56".
 */
export function CampoDeTelefoneComPais({
  id,
  rotulo = "WhatsApp *",
  pais,
  valor,
  onChange,
  invalido = false,
  ajuda,
}: {
  id: string;
  rotulo?: string;
  pais: string | null | undefined;
  valor: string;
  onChange: (telefone: string) => void;
  invalido?: boolean;
  ajuda?: string;
}) {
  const brasil = ehBrasil(pais);
  const lido = separarTelefoneInternacional(valor);
  // O código escolhido fica guardado aqui porque, com o número ainda vazio, não há onde lê-lo.
  const [ddiEscolhido, setDdiEscolhido] = useState(lido.ddi || paisPorCodigo(pais)?.ddi || "");
  useEffect(() => {
    setDdiEscolhido(separarTelefoneInternacional(valor).ddi || paisPorCodigo(pais)?.ddi || "");
    // só quando o país muda: a cada tecla o valor muda e isso desfaria a escolha do código
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pais]);
  const ddi = lido.ddi || ddiEscolhido;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{rotulo}</Label>
      {brasil ? (
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-base text-muted-foreground"
          >
            <span className="text-xl leading-none">{bandeira("BR")}</span>+55
          </span>
          <Input
            id={id}
            inputMode="tel"
            maxLength={20}
            placeholder="(96) 99999-9999"
            value={valor}
            aria-invalid={invalido}
            onChange={(e) => onChange(e.target.value)}
            className="h-11 pl-[4.75rem] text-base"
          />
        </div>
      ) : (
        <div className="flex gap-2">
          <SeletorDeDdi
            ddi={ddi}
            aoEscolher={(novo) => {
              setDdiEscolhido(novo);
              if (lido.nacional) onChange(montarTelefoneInternacional(novo, lido.nacional));
            }}
          />
          <Input
            id={id}
            inputMode="tel"
            maxLength={24}
            placeholder="694 12 34 56"
            value={lido.nacional}
            aria-invalid={invalido}
            onChange={(e) => onChange(montarTelefoneInternacional(ddi, e.target.value))}
            className="h-11 text-base"
          />
        </div>
      )}
      {ajuda && <p className="text-sm text-muted-foreground">{ajuda}</p>}
    </div>
  );
}
