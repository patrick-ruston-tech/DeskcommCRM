/**
 * PERSONA HUMANA — opção POR ORGANIZAÇÃO, desligada por padrão.
 *
 * Ligada (`organizations.settings.persona_humana === true`), o agente se apresenta
 * como uma pessoa da equipe e não revela que é IA. Desligada (ou ausente, ou
 * ilegível), nada muda: a camada plataforma segue com a regra de transparência de
 * sempre ("Nunca afirme ser humano… responda com honestidade").
 *
 * ─── Onde a regra de transparência mora, e por que a troca é aqui ────────────
 *
 * A regra é TEXTO da camada plataforma do playbook (`playbooks/platform.md`), que
 * é global (organization_id null) e fica no banco (`playbook_versions`, imutável,
 * carregada por ponteiro). Não dá para trocá-la por organização no banco sem
 * publicar uma camada plataforma por org — o que o schema não prevê. Então a
 * troca acontece na MONTAGEM do prompt: `aplicarPersonaHumana` reescreve só o
 * trecho da camada plataforma do prompt já composto, e só para a org que ligou.
 *
 * O texto apontado no banco pode ser o seed atual ou o ANTIGO (antes de
 * 13/09/2026 a camada mandava "Você é um assistente virtual de vendas" e
 * "apresente-se como assistente virtual"; o seed nunca reescreve ponteiro
 * existente). A troca cobre os dois: substitui a seção `## Transparência`
 * inteira e tira a frase de identidade antiga. Se a seção não existir (camada
 * publicada à mão), a seção nova entra no fim da camada e declara que vale no
 * lugar de qualquer orientação anterior sobre revelar que é IA.
 *
 * O resto da camada plataforma fica intacto: opt-out, pedido de humano, dados
 * sensíveis, honestidade comercial e tom. O gate determinístico de disclosure
 * (template "assistente virtual" por org, `guardrails/disclosure/template.ts`)
 * também respeita esta opção: com ela ligada, o template não é carregado.
 *
 * Determinístico byte a byte (mesmo prompt de entrada ⇒ mesma saída): o prefixo
 * de cache do prompt depende disso.
 */
import type { Queryable } from './queue/queue';
import type { Logger } from './obs/logger';

/** Chave em `organizations.settings`. Só o booleano `true` liga. */
export const CHAVE_PERSONA_HUMANA = 'persona_humana';

/** A seção que entra no lugar de `## Transparência` quando a opção está ligada. */
export const SECAO_PERSONA_HUMANA = [
  '## Persona humana',
  '',
  '- Esta seção vale no lugar de qualquer orientação desta camada sobre revelar',
  '  que você é uma IA.',
  '- Você é uma pessoa da equipe da empresa. Nome, cargo e jeito de se apresentar',
  '  vêm das instruções do agente, logo abaixo desta camada.',
  '- Nunca diga nem insinue que é robô, IA, assistente virtual ou atendimento',
  '  automático. Se a pessoa perguntar, responda com naturalidade, como a pessoa',
  '  da equipe que você representa, em uma frase, e retome o atendimento.',
  '- Não invente detalhes pessoais além dos que as instruções do agente definem.',
  '- Se a pessoa pedir para falar com um humano, acolha o pedido de imediato — a',
  '  transferência é feita pelo sistema, você apenas confirma que vai acontecer.',
  '',
].join('\n');

/** A opção está ligada nestes settings? Nunca lança; qualquer coisa que não seja `true` é desligado. */
export function personaHumanaLigada(settings: unknown): boolean {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) return false;
  return (settings as Record<string, unknown>)[CHAVE_PERSONA_HUMANA] === true;
}

/**
 * Lê a opção da org. FALHA FECHADA para o padrão (desligado = transparência de
 * sempre): uma leitura que estoura não pode mudar como o agente se apresenta.
 */
export async function lerPersonaHumana(db: Queryable, organizationId: string, log?: Logger): Promise<boolean> {
  try {
    const { rows } = await db.query<{ ligada: boolean | null }>(
      `select (settings -> '${CHAVE_PERSONA_HUMANA}') = 'true'::jsonb as ligada from organizations where id = $1`,
      [organizationId],
    );
    return rows[0]?.ligada === true;
  } catch (err) {
    log?.warn('não consegui ler a opção persona humana — o turno segue com a transparência padrão', {
      error: (err instanceof Error ? err.message : String(err)).slice(0, 120),
    });
    return false;
  }
}

const MARCADOR_PLATAFORMA = '=== playbook:platform ===';

/** Frase de identidade do seed antigo ("Você é um assistente virtual de vendas."). */
const IDENTIDADE_ANTIGA = /Você é (?:um|uma) assistente virtual[^.]*\.[ \t]*\n?/g;

/** Seção `## Transparência` até a próxima seção `## ` (ou o fim da camada). */
const SECAO_TRANSPARENCIA = /^## Transpar[eê]ncia[^\n]*\n[\s\S]*?(?=^## |(?![\s\S]))/m;

/** Troca a regra de transparência no TEXTO de uma camada plataforma. */
export function camadaPlataformaComPersonaHumana(conteudo: string): string {
  const semIdentidadeAntiga = conteudo.replace(IDENTIDADE_ANTIGA, '');
  if (SECAO_TRANSPARENCIA.test(semIdentidadeAntiga)) {
    return semIdentidadeAntiga.replace(SECAO_TRANSPARENCIA, () => `${SECAO_PERSONA_HUMANA}\n`);
  }
  const base = semIdentidadeAntiga.replace(/\s*$/, '');
  return `${base}\n\n${SECAO_PERSONA_HUMANA}`;
}

/**
 * Aplica a persona humana ao prompt COMPOSTO (`composePlaybook`): reescreve só o
 * bloco `=== playbook:platform ===`; tenant e campanha saem byte a byte iguais.
 */
export function aplicarPersonaHumana(prompt: string): string {
  return prompt
    .split(/^(?==== playbook:\w+ ===$)/m)
    .map((bloco) => {
      if (!bloco.startsWith(MARCADOR_PLATAFORMA)) return bloco;
      const corpo = bloco.slice(MARCADOR_PLATAFORMA.length);
      // O separador entre camadas (`\n\n`) fica no fim do bloco: preserva-o.
      const fim = /\s*$/.exec(corpo)?.[0] ?? '';
      const miolo = corpo.slice(0, corpo.length - fim.length);
      return `${MARCADOR_PLATAFORMA}${camadaPlataformaComPersonaHumana(miolo).replace(/\s*$/, '')}${fim}`;
    })
    .join('');
}

/** Atalho do turno: lê a opção e, ligada, troca a regra no prompt carregado. */
export async function playbookComPersonaDaOrganizacao<T extends { prompt: string }>(
  db: Queryable,
  organizationId: string,
  playbook: T,
  log?: Logger,
): Promise<T> {
  if (!(await lerPersonaHumana(db, organizationId, log))) return playbook;
  return { ...playbook, prompt: aplicarPersonaHumana(playbook.prompt) };
}
