import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { composePlaybook } from './agent/playbook';
import {
  SECAO_PERSONA_HUMANA,
  aplicarPersonaHumana,
  camadaPlataformaComPersonaHumana,
  lerPersonaHumana,
  personaHumanaLigada,
  playbookComPersonaDaOrganizacao,
} from './persona-humana';
import type { Queryable } from './queue/queue';

const PLATFORM = readFileSync(path.join(process.cwd(), 'lib', 'agent-engine', 'playbooks', 'platform.md'), 'utf8');

/** O seed anterior a 13/09/2026 — ainda é o texto apontado em instalação antiga (o seed não move ponteiro). */
const PLATFORM_ANTIGO = [
  '# Camada plataforma — compliance e marca',
  '',
  '## Identidade',
  '',
  'Você é um assistente virtual de vendas. Você conversa por WhatsApp em nome da',
  'empresa da organização, sempre em português do Brasil, com naturalidade e',
  'respeito.',
  '',
  '## Transparência',
  '',
  '- Na primeira interação de uma conversa, apresente-se como assistente virtual.',
  '- Nunca finja ser humano; se perguntarem, confirme que é um assistente virtual.',
  '- Se a pessoa pedir para falar com um humano, acolha o pedido de imediato — a',
  '  transferência é feita pelo sistema, você apenas confirma que vai acontecer.',
  '',
  '## Respeito ao lead',
  '',
  '- Nunca peça dados sensíveis (documentos, senhas, dados bancários) por mensagem.',
  '',
].join('\n');

const TENANT = '## Persona\n\nVocê é Ana, consultora da Loja Exemplo.\n';

function fakeDb(resposta: unknown): Queryable {
  return { query: vi.fn(async () => resposta) } as unknown as Queryable;
}

describe('personaHumanaLigada', () => {
  it('só o booleano true liga; ausente, texto, null e lixo ficam no padrão (desligado)', () => {
    expect(personaHumanaLigada({ persona_humana: true })).toBe(true);
    for (const s of [undefined, null, {}, { persona_humana: 'true' }, { persona_humana: 1 }, { persona_humana: false }, []]) {
      expect(personaHumanaLigada(s)).toBe(false);
    }
  });
});

describe('modo padrão (desligado): a transparência fica como sempre', () => {
  it('o prompt sai byte a byte igual quando a org não ligou', async () => {
    const playbook = { prompt: composePlaybook([{ layer: 'platform', content: PLATFORM }, { layer: 'tenant', content: TENANT }]) };
    const r = await playbookComPersonaDaOrganizacao(fakeDb({ rows: [{ ligada: false }] }), 'org', playbook);
    expect(r).toBe(playbook);
    expect(r.prompt).toContain('Nunca afirme ser humano');
    expect(r.prompt).toContain('responda com honestidade');
  });

  it('leitura que falha cai no padrão (falha fechada para a transparência)', async () => {
    const db = { query: vi.fn(async () => { throw new Error('boom'); }) } as unknown as Queryable;
    const warn = vi.fn();
    expect(await lerPersonaHumana(db, 'org', { info: vi.fn(), warn, error: vi.fn() })).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(await lerPersonaHumana(fakeDb({ rows: [] }), 'org')).toBe(false);
  });
});

describe('modo persona humana (ligado)', () => {
  it('troca a seção Transparência do seed atual e mantém o resto da camada plataforma', () => {
    const r = camadaPlataformaComPersonaHumana(PLATFORM);
    expect(r).not.toMatch(/Nunca afirme ser humano/);
    expect(r).not.toMatch(/responda com honestidade/);
    expect(r).not.toMatch(/^## Transparência/m);
    expect(r).toContain(SECAO_PERSONA_HUMANA);
    // O que é compliance e não é identidade continua.
    expect(r).toContain('acolha o pedido de imediato');
    expect(r).toContain('não quer mais receber mensagens');
    expect(r).toContain('Nunca peça dados sensíveis');
    expect(r).toContain('## Honestidade comercial');
    expect(r).toContain('## Tom de escrita');
    expect(r).toContain('## Identidade');
  });

  it('cobre o seed antigo: tira "Você é um assistente virtual" e a seção Transparência', () => {
    const r = camadaPlataformaComPersonaHumana(PLATFORM_ANTIGO);
    expect(r).not.toMatch(/assistente virtual de vendas/);
    expect(r).not.toMatch(/apresente-se como assistente virtual/);
    expect(r).not.toMatch(/confirme que é um assistente virtual/);
    expect(r).toContain('Você conversa por WhatsApp em nome da');
    expect(r).toContain(SECAO_PERSONA_HUMANA);
    expect(r).toContain('Nunca peça dados sensíveis');
  });

  it('camada sem a seção Transparência (publicada à mão): a seção nova entra no fim', () => {
    const r = camadaPlataformaComPersonaHumana('## Outra\n\n- regra qualquer\n');
    expect(r).toBe(`## Outra\n\n- regra qualquer\n\n${SECAO_PERSONA_HUMANA}`);
  });

  it('só a camada plataforma muda; tenant e campanha saem iguais e o resultado é determinístico', async () => {
    const prompt = composePlaybook([
      { layer: 'platform', content: PLATFORM },
      { layer: 'tenant', content: TENANT },
      { layer: 'campaign', content: '## Campanha\n\nNão revele que é robô.\n' },
    ]);
    const r = await playbookComPersonaDaOrganizacao(fakeDb({ rows: [{ ligada: true }] }), 'org', { prompt, versionIds: {} });
    expect(r.prompt).not.toContain('Nunca afirme ser humano');
    expect(r.prompt).toContain('=== playbook:platform ===\n# Camada plataforma');
    expect(r.prompt).toContain(`=== playbook:tenant ===\n${TENANT}`);
    expect(r.prompt).toContain('=== playbook:campaign ===\n## Campanha\n\nNão revele que é robô.\n');
    expect(r.prompt.indexOf('=== playbook:platform ===')).toBeLessThan(r.prompt.indexOf('=== playbook:tenant ==='));
    expect(aplicarPersonaHumana(prompt)).toBe(r.prompt);
    expect(r.versionIds).toEqual({});
  });
});
