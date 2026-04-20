const {
  getAgentModelConfig,
  setAgentModelConfig,
  listAgentModelConfigs,
  saveAgentModelConfigs,
  resolveRoleModelConfig,
  getRoleModelConfig,
  saveModelConfig,
  getModelConfig,
} = require('../src/services/settings-store');

describe('settings-store agentModels', () => {
  beforeAll(async () => {
    // Ensure clean state
    await saveAgentModelConfigs({});
  });

  afterEach(async () => {
    await saveAgentModelConfigs({});
  });

  test('listAgentModelConfigs returns empty when no agentModels', async () => {
    const configs = await listAgentModelConfigs();
    expect(configs).toEqual({});
  });

  test('setAgentModelConfig saves and getAgentModelConfig retrieves', async () => {
    await setAgentModelConfig('editor', { provider: 'anthropic', model: 'claude-sonnet-4', temperature: 0.3 });
    const cfg = await getAgentModelConfig('editor');
    expect(cfg).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4', temperature: 0.3 });
  });

  test('delete agent model config by passing null', async () => {
    await setAgentModelConfig('editor', { provider: 'anthropic', model: 'claude-sonnet-4', temperature: 0.3 });
    await setAgentModelConfig('editor', null);
    const cfg = await getAgentModelConfig('editor');
    expect(cfg).toBeNull();
  });

  test('saveAgentModelConfigs batch updates', async () => {
    await saveAgentModelConfigs({
      writer: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.85 },
      editor: { provider: 'anthropic', model: 'claude-sonnet-4', temperature: 0.3 },
    });
    const configs = await listAgentModelConfigs();
    expect(configs.writer).toEqual({ provider: 'openai', model: 'gpt-4o-mini', temperature: 0.85 });
    expect(configs.editor).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4', temperature: 0.3 });
  });

  test('resolveRoleModelConfig prefers agentModels over roleDefaults', async () => {
    // First set roleDefaults for writer
    const mc = await getModelConfig();
    mc.roleDefaults = mc.roleDefaults || {};
    mc.roleDefaults.writer = { provider: 'openai', model: 'gpt-4o', temperature: 0.7 };
    await saveModelConfig(mc);

    // Set agentModels writer to a different model
    await setAgentModelConfig('writer', { provider: 'anthropic', model: 'claude-haiku', temperature: 0.5 });

    const cfg = await resolveRoleModelConfig('writer');
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.model).toBe('claude-haiku');
    expect(cfg.temperature).toBe(0.5);

    // Clean up
    await setAgentModelConfig('writer', null);
    const mc2 = await getModelConfig();
    delete mc2.roleDefaults.writer;
    await saveModelConfig(mc2);
  });

  test('getRoleModelConfig falls back to roleDefaults when no agentModels', async () => {
    const mc = await getModelConfig();
    mc.roleDefaults = mc.roleDefaults || {};
    mc.roleDefaults.proofreader = { provider: 'openai', model: 'gpt-4o', temperature: 0.5 };
    await saveModelConfig(mc);

    // No agentModels for proofreader
    await setAgentModelConfig('proofreader', null);

    const cfg = await getRoleModelConfig('proofreader');
    expect(cfg.provider).toBe('openai');
    expect(cfg.model).toBe('gpt-4o');
    expect(cfg.temperature).toBe(0.5);

    // Clean up
    const mc2 = await getModelConfig();
    delete mc2.roleDefaults.proofreader;
    await saveModelConfig(mc2);
  });
});
