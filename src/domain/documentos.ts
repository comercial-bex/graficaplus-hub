/**
 * CPF e CNPJ: normalização, validação por dígito verificador e formatação.
 *
 * Validar antes de gravar evita o caso mais chato: documento digitado errado que
 * só aparece quando a nota fiscal é recusada. O dígito verificador pega erro de
 * digitação (troca de posição, dígito faltando) sem precisar consultar nada.
 */

export type TipoDocumento = "cpf" | "cnpj";

/** Só os dígitos — é assim que o documento deve ser comparado e consultado. */
export function apenasDigitos(valor: string): string {
  return (valor ?? "").replace(/\D/g, "");
}

/** Pelo comprimento: 11 dígitos é CPF, 14 é CNPJ. */
export function tipoPorTamanho(valor: string): TipoDocumento | null {
  const d = apenasDigitos(valor);
  if (d.length === 11) return "cpf";
  if (d.length === 14) return "cnpj";
  return null;
}

export function validarCPF(valor: string): boolean {
  const d = apenasDigitos(valor);
  if (d.length !== 11) return false;
  // Sequências repetidas passam na conta dos dígitos, mas não são CPF válido.
  if (/^(\d)\1{10}$/.test(d)) return false;

  const digito = (ateIndice: number, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < ateIndice; i++) soma += Number(d[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return digito(9, 10) === Number(d[9]) && digito(10, 11) === Number(d[10]);
}

export function validarCNPJ(valor: string): boolean {
  const d = apenasDigitos(valor);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const digito = (ateIndice: number) => {
    // pesos do CNPJ: 5,4,3,2,9,8,7,6,5,4,3,2 (deslocados para o 2º dígito)
    let peso = ateIndice - 7;
    let soma = 0;
    for (let i = 0; i < ateIndice; i++) {
      soma += Number(d[i]) * peso;
      peso -= 1;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return digito(12) === Number(d[12]) && digito(13) === Number(d[13]);
}

export function validarDocumento(valor: string, tipo?: TipoDocumento): boolean {
  const alvo = tipo ?? tipoPorTamanho(valor);
  if (alvo === "cpf") return validarCPF(valor);
  if (alvo === "cnpj") return validarCNPJ(valor);
  return false;
}

/** "12345678901" -> "123.456.789-01" ; "19131243000197" -> "19.131.243/0001-97" */
export function formatarDocumento(valor: string, tipo?: TipoDocumento): string {
  const d = apenasDigitos(valor);
  const alvo = tipo ?? tipoPorTamanho(d);

  if (alvo === "cpf") {
    return d
      .slice(0, 11)
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  }
  if (alvo === "cnpj") {
    return d
      .slice(0, 14)
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2")
      .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  }
  return d;
}

/** Quantidade de dígitos esperada, para máscara e para saber quando consultar. */
export function tamanhoEsperado(tipo: TipoDocumento): number {
  return tipo === "cpf" ? 11 : 14;
}

/** "11987654321" -> "(11) 98765-4321" ; aceita fixo de 10 dígitos. */
export function formatarTelefone(valor: string): string {
  const d = apenasDigitos(valor);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return valor ?? "";
}

/** "01311902" -> "01311-902" */
export function formatarCEP(valor: string): string {
  const d = apenasDigitos(valor);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (valor ?? "");
}

/**
 * Chave canônica de telefone para reconhecer a mesma pessoa.
 *
 * Espelha public.normalize_whatsapp_phone no banco, que alimenta as colunas
 * telefone_normalizado de clientes, leads e conversas. As duas precisam
 * concordar: se divergirem, a tela acha um cliente e o banco acha outro.
 *
 * Regra: só dígitos; tira o código do país 55 (12–13 dígitos); acrescenta o
 * nono dígito em celular de 10 dígitos — o primeiro dígito após o DDD entre 6 e
 * 9 é celular, de 2 a 5 é fixo e não recebe o 9.
 *
 * Assim "(96) 99111-2233", "96991112233", "5596991112233" e "9691112233" viram
 * todos "96991112233".
 */
export function chaveWhatsApp(valor: string | null | undefined): string | null {
  let d = apenasDigitos(valor ?? "");
  if (!d) return null;

  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) {
    d = d.slice(2);
  }
  if (d.length === 10 && d[2] >= "6" && d[2] <= "9") {
    d = `${d.slice(0, 2)}9${d.slice(2)}`;
  }
  return d;
}
