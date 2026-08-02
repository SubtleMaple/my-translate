import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/stores/settingsStore'

export function SettingsView() {
  const { settings, loaded, testing, saveLlm, testConnection, setAlwaysOnTop, setOpacity } =
    useSettingsStore()

  // LLM 表单草稿：仅在设置加载完成后同步一次，之后以用户编辑为准
  const [baseURL, setBaseURL] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  useEffect(() => {
    if (loaded) {
      setBaseURL(settings.llm.baseURL)
      setApiKey(settings.llm.apiKey)
      setModel(settings.llm.model)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  const currentLlm = () => ({
    baseURL: baseURL.trim(),
    apiKey: apiKey.trim(),
    model: model.trim()
  })

  const onSave = async () => {
    await saveLlm(currentLlm())
    toast.success('设置已保存')
  }

  const onTest = async () => {
    // 先保存再测试，保证测试的是当前表单内容
    await saveLlm(currentLlm())
    const result = await testConnection()
    if (result.ok) {
      toast.success(result.message)
    } else {
      toast.error(result.message)
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">大模型</CardTitle>
          <CardDescription className="text-xs">
            支持任意 OpenAI 兼容 API。Base URL 通常以 /v1 结尾。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="base-url">API Base URL</Label>
            <Input
              id="base-url"
              placeholder="https://api.openai.com/v1"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="api-key">API Key</Label>
            <Input
              id="api-key"
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model">Model 名称</Label>
            <Input
              id="model"
              placeholder="gpt-4o-mini"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
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
