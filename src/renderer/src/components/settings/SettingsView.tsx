import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { getActiveLlm } from '@shared/llm'
import type { ApiType, LlmProviderConfig } from '@shared/types'
import { useSettingsStore } from '@/stores/settingsStore'

const TYPE_LABELS: Record<ApiType, string> = {
  openai: 'OpenAI 兼容',
  anthropic: 'Anthropic'
}

const TYPE_HINTS: Record<ApiType, string> = {
  openai: '支持任意 OpenAI 兼容 API。Base URL 通常以 /v1 结尾。',
  anthropic: 'Anthropic messages API（Claude 系列）。Base URL 以 /v1 结尾，如 https://api.anthropic.com/v1。'
}

const THINKING_HINTS: Record<'auto' | 'off', string> = {
  auto: '跟随模型默认（思考型模型默认开启思考）',
  off: '关闭思考模式（deepseek-v4-flash 等思考模型，响应更快更省）'
}

const TYPE_PLACEHOLDERS: Record<ApiType, { baseURL: string; apiKey: string; model: string }> = {
  openai: { baseURL: 'https://api.openai.com/v1', apiKey: 'sk-...', model: 'gpt-4o-mini' },
  anthropic: {
    baseURL: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-...',
    model: 'claude-sonnet-4-20250514'
  }
}

export function SettingsView() {
  const { settings, loaded, testing, saveLlm, setLlmType, testConnection, setAlwaysOnTop, setOpacity, setMinimal } =
    useSettingsStore()

  // LLM 表单草稿：绑定当前类型的配置；切换类型时切换为该类型的已存值
  const [type, setType] = useState<ApiType>('openai')
  const [baseURL, setBaseURL] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [thinking, setThinking] = useState<'auto' | 'off'>('auto')
  useEffect(() => {
    if (loaded) {
      setType(settings.llm.type)
      const c = getActiveLlm(settings.llm).config
      setBaseURL(c.baseURL)
      setApiKey(c.apiKey)
      setModel(c.model)
      setThinking(c.thinking)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  const currentDraft = (): LlmProviderConfig => ({
    baseURL: baseURL.trim(),
    apiKey: apiKey.trim(),
    model: model.trim(),
    thinking
  })

  const onTypeChange = (t: ApiType) => {
    if (t === type) return
    const stored = settings.llm[t]
    setType(t)
    setBaseURL(stored.baseURL)
    setApiKey(stored.apiKey)
    setModel(stored.model)
    setThinking(stored.thinking)
    // 切换即持久化生效（当前草稿归属另一类型，不随切换保存）
    void setLlmType(t).then(() => toast.success(`已切换到 ${TYPE_LABELS[t]} API`))
  }

  const buildLlm = () => ({
    type,
    openai: type === 'openai' ? currentDraft() : settings.llm.openai,
    anthropic: type === 'anthropic' ? currentDraft() : settings.llm.anthropic
  })

  const onSave = async () => {
    await saveLlm(buildLlm())
    toast.success('设置已保存')
  }

  const onTest = async () => {
    // 先保存再测试，保证测试的是当前表单内容
    await saveLlm(buildLlm())
    const result = await testConnection()
    if (result.ok) {
      toast.success(result.message)
    } else {
      toast.error(result.message)
    }
  }

  const ph = TYPE_PLACEHOLDERS[type]

  return (
    <div className="flex flex-col gap-3 p-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">大模型</CardTitle>
          <CardDescription className="text-xs">{TYPE_HINTS[type]}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>API 类型</Label>
            <Select value={type} onValueChange={(v) => onTypeChange(v as ApiType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI 兼容</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="base-url">API Base URL</Label>
            <Input
              id="base-url"
              placeholder={ph.baseURL}
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="api-key">API Key</Label>
            <Input
              id="api-key"
              type="password"
              placeholder={ph.apiKey}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model">Model 名称</Label>
            <Input
              id="model"
              placeholder={ph.model}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>思考模式</Label>
            <Select value={thinking} onValueChange={(v) => setThinking(v as 'auto' | 'off')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动（默认）</SelectItem>
                <SelectItem value="off">关闭</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{THINKING_HINTS[thinking]}</p>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={onSave}>
              保存设置
            </Button>
            <Button size="sm" variant="outline" disabled={testing} onClick={onTest}>
              {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              测试连接
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">外观</CardTitle>
          <CardDescription className="text-xs">即时生效并自动保存</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>极简模式</Label>
              <p className="text-xs text-muted-foreground">只保留输入框与翻译按钮，译文替换原句显示</p>
            </div>
            <Switch
              checked={settings.ui.minimal}
              onCheckedChange={(flag) => void setMinimal(flag)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">窗口</CardTitle>
          <CardDescription className="text-xs">即时生效并自动保存</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="always-on-top">始终置顶</Label>
            <Switch
              id="always-on-top"
              checked={settings.window.alwaysOnTop}
              onCheckedChange={(flag) => setAlwaysOnTop(flag)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>窗口透明度</Label>
              <span className="text-xs text-muted-foreground">
                {Math.round(settings.window.opacity * 100)}%
              </span>
            </div>
            <Slider
              min={50}
              max={100}
              step={1}
              value={[Math.round(settings.window.opacity * 100)]}
              onValueChange={(v) => setOpacity(v[0] / 100)}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
