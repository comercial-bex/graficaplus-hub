import { useState, type ClipboardEvent, type FocusEvent, type Ref } from "react";
import { Input } from "@/components/ui/input";
import { SeletorDeDdi } from "@/components/cliente/campo-de-pais";
import {
  exemploDoNumero,
  montarTelefoneInternacional,
  separarTelefoneInternacional,
  textoParaCampoDeTelefone,
} from "@/domain/clientes/paises";

/**
 * O campo de telefone com bandeira e código do país (26/11/2026, pedido do dono: cliente da França, da Guiana Francesa e
 * da Colômbia não cabiam em campo que só aceitava o Brasil).
 *
 * É o mesmo texto que o formulário já guardava, sem campo novo no banco:
 *   Brasil   o que a pessoa digita, como sempre: "(96) 99999-9999";
 *   de fora  "+" e o código do país na frente: "+33 6 12 34 56 78" (o zero de discagem sai sozinho).
 *
 * O botão da esquerda troca o país. Quem cola "+33 6 12…", "0033 6 12…" ou o link wa.me de um número de fora também cai
 * no país certo, sem precisar escolher a bandeira. O rótulo (`<Label htmlFor={id}>`) fica por conta de quem usa.
 */
export function CampoDeTelefoneInternacional({
  id,
  valor,
  onChange,
  invalido = false,
  autoFocus = false,
  descritoPor,
  onPaste,
  onBlur,
  inputRef,
  placeholderBrasil = "(96) 99999-9999",
  maxLength,
  className,
}: {
  id: string;
  valor: string;
  onChange: (telefone: string) => void;
  invalido?: boolean;
  autoFocus?: boolean;
  descritoPor?: string;
  onPaste?: (e: ClipboardEvent<HTMLInputElement>) => void;
  /** Ao sair do campo. Quem formata o número brasileiro faz isso aqui, olhando o `valor` inteiro (o campo de fora mostra só a parte nacional). */
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  inputRef?: Ref<HTMLInputElement>;
  placeholderBrasil?: string;
  maxLength?: number;
  className?: string;
}) {
  const lido = separarTelefoneInternacional(valor);
  const deFora = lido.ddi !== "" && lido.ddi !== "55";
  // O país escolhido fica guardado aqui porque, com o número ainda vazio, não há onde lê-lo.
  const [escolhido, setEscolhido] = useState("55");
  const ddi = deFora ? lido.ddi : valor.trim() === "" ? escolhido : "55";
  const fora = ddi !== "55";

  function digitar(texto: string) {
    if (fora) {
      onChange(montarTelefoneInternacional(ddi, texto));
      return;
    }
    // No campo brasileiro a pessoa pode colar um número de fora inteiro: ele muda o país sozinho.
    const arrumado = textoParaCampoDeTelefone(texto);
    const l = separarTelefoneInternacional(arrumado);
    if (l.ddi && l.ddi !== "55") {
      setEscolhido(l.ddi);
      onChange(montarTelefoneInternacional(l.ddi, l.nacional));
      return;
    }
    onChange(arrumado);
  }

  function trocarDeDdi(novo: string) {
    setEscolhido(novo);
    // Número brasileiro não serve de um país para o outro; de fora para de fora, o número fica e o código muda.
    if (fora && novo !== "55" && lido.nacional) onChange(montarTelefoneInternacional(novo, lido.nacional));
    else onChange(fora && novo === "55" ? lido.nacional : "");
  }

  return (
    <div className={className ?? "flex gap-2"}>
      <SeletorDeDdi ddi={ddi} aoEscolher={trocarDeDdi} />
      <Input
        id={id}
        ref={inputRef}
        inputMode="tel"
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={maxLength}
        placeholder={fora ? exemploDoNumero(ddi) : placeholderBrasil}
        value={fora ? lido.nacional : valor}
        aria-invalid={invalido || undefined}
        aria-describedby={descritoPor}
        onChange={(e) => digitar(e.target.value)}
        onPaste={onPaste}
        onBlur={onBlur}
        className="h-11 min-w-0 flex-1 text-base"
      />
    </div>
  );
}
