// ==================== 核心实体类型 ====================

export interface WorkAttributes {
  workId: string;
  topic: string;
  style?: string;
  platformStyle?: string;
  authorStyle?: string;
  strategy?: 'knowrite' | 'pipeline';
  outlineTheme?: string;
  outlineDetailed?: string;
  outlineMultivolume?: string;
  currentVolume?: number;
  reviews?: Record<string, unknown>;
  fitness?: Record<string, unknown>;
  writingMode?: string | null;
  language?: string;
  status?: string;
  pausedAtStep?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface VolumeAttributes {
  id?: number;
  workId: string;
  number: number;
  title?: string;
  outlineFile?: string;
  chapterRange?: number[];
  status?: string;
}

export interface ChapterAttributes {
  id?: number;
  workId: string;
  number: number;
  rawFile?: string;
  editedFile?: string;
  humanizedFile?: string;
  finalFile?: string;
  polishFile?: string;
  feedbackFile?: string;
  summaryFile?: string;
  editFile?: string;
  repetitionRepairedFile?: string;
  chars?: number;
  models?: Record<string, string>;
}

export interface WorkFileAttributes {
  id?: number;
  workId: string;
  filename: string;
  content?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SettingAttributes {
  key: string;
  value?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PromptAttributes {
  id?: number;
  name: string;
  lang?: string;
  content?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// ==================== 世界观 / 人物 / 剧情 ====================

export interface WorldLoreAttributes {
  id?: number;
  workId: string;
  category?: string;
  title: string;
  content?: string;
  tags?: string[];
  importance?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CharacterAttributes {
  id?: number;
  workId: string;
  name: string;
  alias?: string;
  roleType?: string;
  status?: string;
  appearance?: string;
  personality?: string;
  goals?: string;
  background?: string;
  notes?: string;
  voiceFingerprint?: Record<string, unknown> | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CharacterRelationAttributes {
  id?: number;
  workId: string;
  fromCharId: number;
  toCharId: number;
  relationType?: string;
  description?: string;
  strength?: number;
  bidirectional?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CharacterMemoryAttributes {
  id?: number;
  workId: string;
  charName: string;
  chapterNumber: number;
  episodeType?: string;
  content: string;
  importance?: number;
  tags?: string[];
  sourceText?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PlotLineAttributes {
  id?: number;
  workId: string;
  name: string;
  type?: string;
  status?: string;
  color?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PlotNodeAttributes {
  id?: number;
  workId: string;
  plotLineId: number;
  chapterNumber?: number | null;
  title?: string;
  description?: string;
  nodeType?: string;
  position?: number;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MapRegionAttributes {
  id?: number;
  workId: string;
  name: string;
  regionType?: string;
  parentId?: number | null;
  description?: string;
  coordinates?: Record<string, unknown> | null;
  tags?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MapConnectionAttributes {
  id?: number;
  workId: string;
  fromRegionId: number;
  toRegionId: number;
  connType?: string;
  description?: string;
  travelTime?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// ==================== 模板 / 嵌入 / 风格 ====================

export interface StoryTemplateAttributes {
  id?: number;
  scope?: string;
  workId?: string | null;
  name: string;
  category?: string;
  description?: string;
  beatStructure?: unknown[];
  exampleWorks?: string;
  tags?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface WorkTemplateLinkAttributes {
  id?: number;
  workId: string;
  templateId: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EmbeddingAttributes {
  id?: number;
  workId: string;
  chapterNumber?: number | null;
  sourceType: string;
  sourceId?: string;
  content?: string;
  embedding?: string;
  model?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AuthorFingerprintAttributes {
  id?: number;
  name: string;
  description?: string | null;
  narrativeLayer?: Record<string, unknown> | null;
  characterLayer?: Record<string, unknown> | null;
  plotLayer?: Record<string, unknown> | null;
  languageLayer?: Record<string, unknown> | null;
  worldLayer?: Record<string, unknown> | null;
  sampleParagraphs?: string[];
  styleGuide?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface WorkStyleLinkAttributes {
  id?: number;
  workId: string;
  fingerprintId: number;
  isActive?: boolean;
  priority?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

// ==================== 时序真相 ====================

export interface TruthEventAttributes {
  id?: number;
  workId: string;
  chapterNumber: number;
  eventSequence: number;
  eventType: string;
  subjectType: string;
  subjectId: string;
  payload: Record<string, unknown>;
  sourceChapter: number;
  sourceText?: string | null;
  extractedBy?: string;
  confidence?: number;
  createdAt?: Date;
}

export interface TruthStateAttributes {
  id?: number;
  workId: string;
  chapterNumber: number;
  characterStates?: unknown[];
  worldState?: Record<string, unknown>;
  emotionalArcs?: unknown[] | null;
  isMaterialized?: boolean;
  lastEventId?: number | null;
  computedAt?: Date | null;
  statsSnapshot?: Record<string, unknown> | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TruthHookAttributes {
  id?: number;
  workId: string;
  hookId: string;
  description: string;
  type?: string;
  createdChapter: number;
  targetChapter?: number | null;
  resolvedChapter?: number | null;
  status?: string;
  importance?: string;
  relatedCharacters?: string[];
  notes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TruthResourceAttributes {
  id?: number;
  workId: string;
  name: string;
  category?: string | null;
  owner?: string | null;
  quantity?: number;
  description?: string | null;
  acquiredChapter?: number | null;
  consumedChapter?: number | null;
  lostChapter?: number | null;
  status?: string;
  transferHistory?: unknown[];
  createdAt?: Date;
  updatedAt?: Date;
}

// ==================== 输入 / 输出治理 ====================

export interface OutputQueueAttributes {
  id?: number;
  workId: string;
  chapterNumber: number;
  enqueuedAt: Date;
  priority?: number;
  fitnessScore?: number | null;
  status?: string;
  l1Result?: Record<string, unknown> | null;
  l2Result?: Record<string, unknown> | null;
  humanReview?: Record<string, unknown> | null;
  releasedAt?: Date | null;
  releasedBy?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OutputValidationRuleAttributes {
  id?: number;
  name: string;
  level: string;
  category: string;
  condition: Record<string, unknown>;
  action?: string;
  isActive?: boolean;
  description?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AuthorIntentAttributes {
  id?: number;
  workId: string;
  longTermVision?: string | null;
  tone?: string | null;
  themes?: string[] | null;
  constraints?: string[] | null;
  mustKeep?: string | null;
  mustAvoid?: string | null;
  notes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CurrentFocusAttributes {
  id?: number;
  workId: string;
  focusText: string;
  targetChapters?: number;
  priority?: string;
  expiresAt?: Date | null;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ChapterIntentAttributes {
  id?: number;
  workId: string;
  chapterNumber: number;
  mustKeep?: string | null;
  mustAvoid?: string | null;
  sceneBeats?: unknown[] | null;
  conflictResolution?: string | null;
  emotionalGoal?: string | null;
  ruleStack?: unknown[] | null;
  plannedAt?: Date | null;
  composedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

// ==================== LLM / Provider 类型 ====================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
  content: string;
  name?: string;
}

export interface ChatOptions {
  model?: string;
  provider?: string;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  chatId?: string;
  multimedia?: unknown;
  shouldRemoveConversation?: boolean;
}

export interface ProviderConfig {
  name: string;
  baseURL: string;
  apiKey: string;
  models: string[];
  defaultModel?: string;
}

export interface ModelConfig {
  providers: Record<string, ProviderConfig>;
  roleDefaults: Record<string, string>;
  agentModels?: Record<string, string>;
  writerRotation?: string[];
}

export type AgentRole =
  | 'outline'
  | 'writer'
  | 'editor'
  | 'humanizer'
  | 'proofreader'
  | 'reader'
  | 'summarizer'
  | 'polish'
  | 'deviationCheck'
  | 'styleCorrect'
  | 'repetitionRepair'
  | 'promptEvolve';

// ==================== SSE / 业务事件类型 ====================

export type SSEEventType =
  | 'chunk'
  | 'stepStart'
  | 'stepEnd'
  | 'done'
  | 'paused'
  | 'error';

export interface SSEEvent {
  type: SSEEventType;
  data?: string;
  step?: string;
  agentType?: string;
  message?: string;
}

export interface PipelineStage {
  name: string;
  enabled: boolean;
  autoSkip?: boolean;
}

export interface FitnessScore {
  overall: number;
  dimensions: Record<string, number>;
  passed: boolean;
}

// ==================== 通用工具类型 ====================

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
