import { Icone } from "./icones";
import { Relogio } from "./relogio";
import { MarcaETitulo } from "./tela-da-oficina";
import { CARTOES_DE_PRAZO } from "@/domain/tv/tela";

/**
 * A parede sem dado nenhum: a TV ligou e ainda não recebeu resposta
 * (carregando) ou a primeira busca falhou. NUNCA zeros — travessões. Zero se
 * lê como "oficina parada"; travessão se lê como "não sei".
 */
export type MotivoSemDado =
  | { tipo: "carregando" }
  | { tipo: "sem_conexao"; ligouAs: string; detalhe: string; intervaloS: number }
  | { tipo: "dado_invalido"; ligouAs: string; detalhe: string; intervaloS: number };

export function SemDado({
  motivo,
  data,
  exemplo,
  desvioMs,
}: {
  motivo: MotivoSemDado;
  data: string;
  exemplo: boolean;
  desvioMs: number;
}) {
  const carregando = motivo.tipo === "carregando";
  const rotuloDosMinis = ["ENTRADA E ARTE", "FILA SEM MÁQUINA", "ACABAMENTO", "NA SAÍDA"];
  return (
    <div className="tela quieto" data-selo={motivo.tipo}>
      <header className="cab">
        <MarcaETitulo data={data} exemplo={exemplo} />
        <div className="dir">
          {carregando ? (
            <div className="chip cinza fixo" data-selo-texto>
              <Icone nome="Clock" px={24} />
              <span>CARREGANDO…</span>
            </div>
          ) : (
            <div className="chip vermelho fixo" data-selo-texto>
              <Icone nome={motivo.tipo === "sem_conexao" ? "WifiOff" : "TriangleAlert"} px={24} />
              <span>{motivo.tipo === "sem_conexao" ? "SEM CONEXÃO" : "DADO INVÁLIDO"}</span>
            </div>
          )}
          <Relogio desvioMs={desvioMs} />
        </div>
      </header>
      {!carregando ? (
        <div className="faixa vermelha" data-faixa="vermelha">
          <Icone nome={motivo.tipo === "sem_conexao" ? "WifiOff" : "TriangleAlert"} px={28} />
          <span className="corta">
            {motivo.tipo === "sem_conexao" ? "SEM CONEXÃO" : "DADO INVÁLIDO"} — esta TV ainda não
            recebeu nenhum dado desde que ligou, às {motivo.ligouAs} ({motivo.detalhe}). Nova
            tentativa a cada {motivo.intervaloS} s.
          </span>
        </div>
      ) : null}
      <section className="kpis">
        <div className="grandes">
          {CARTOES_DE_PRAZO.map((z) => (
            <div key={z.k} className="grande vago" data-cartao={z.k}>
              <div className="rot cx fixo">
                <Icone nome={z.icone} px={26} />
                <span>{z.nome}</span>
              </div>
              <div className="num" data-total>
                —
              </div>
              <div className="sub cx fixo">{" "}</div>
            </div>
          ))}
        </div>
        <div className="minis">
          {rotuloDosMinis.map((r) => (
            <div key={r} className="mini vago">
              <div className="l1">
                <span className="n" style={{ color: "var(--apoio)" }} data-total>
                  —
                </span>
              </div>
              <div className="r cx fixo">{r}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="maquinas">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="maq vaga">
            <div className="topo">
              <div className="nomel">
                <div className="nome cx fixo" style={{ color: "var(--apoio)" }}>
                  <Icone nome="Layers" px={28} />
                  <span>máquina</span>
                </div>
              </div>
              <div className="barra" />
            </div>
            <div className="estado">
              <div className="palavra fixo">{carregando ? "CARREGANDO" : "SEM DADO"}</div>
              <div className="desde fixo" style={{ color: "var(--apoio)" }}>
                {carregando ? "buscando o painel…" : "servidor sem resposta"}
              </div>
            </div>
          </div>
        ))}
      </section>
      <footer className="rodape">
        <div className="etq cx fixo">
          <Icone nome="Truck" px={28} />
          <span>Saídas</span>
        </div>
        <div className="trilho">
          <span className="vazio fixo">{carregando ? "carregando…" : "sem dado do servidor"}</span>
        </div>
        <div className="canto">
          <div className="c1 cx fixo">
            <Icone nome="BellRing" px={24} />
            <span>Eventos</span>
          </div>
          <div className="c2 corta" style={{ color: "var(--apoio)" }}>
            —
          </div>
        </div>
      </footer>
    </div>
  );
}
