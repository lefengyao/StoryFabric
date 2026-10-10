# 单模型 JSON 配置规范（v1）

在「模型与供应商 → 管理模型」中展开一个已添加的模型，底部的「完整 JSON 配置」会显示该模型当前生效的所有可配置属性。可以直接编辑或粘贴符合本规范的 JSON，点击「应用 JSON」后再点击页面右上角「保存」。应用只替换当前模型的属性，不会修改同一供应商的其他模型，也不包含供应商密钥或地址。

```json
{
  "schemaVersion": 1,
  "reasoningSupport": true,
  "vision": true,
  "reasoning": "medium",
  "reasoningMap": {
    "path": "reasoning_effort",
    "values": {
      "low": "low",
      "medium": "medium",
      "high": "high"
    }
  },
  "contextTokens": 131072,
  "maxOutputTokens": 8192
}
```

所有顶层字段都必须存在；不支持额外字段。`schemaVersion` 固定为 `1`。

| 字段 | 类型与含义 |
| --- | --- |
| `reasoningSupport` | 布尔值；模型是否支持扩展思考。 |
| `vision` | 布尔值；模型是否支持图片输入。 |
| `reasoning` | `off`、`low`、`medium` 或 `high`。 |
| `reasoningMap` | `null` 表示使用协议内置参数；自定义时填写 `path` 和 `values`。 |
| `contextTokens` | 正整数；模型上下文窗口，仅用于应用内计算与展示。 |
| `maxOutputTokens` | 正整数；单次回复输出上限，不得大于 `contextTokens`。 |

`reasoningMap.values` 可包含 `off`、`low`、`medium`、`high` 中的一个或多个键，值都必须是字符串。数字或布尔参数也要写成字符串，例如 `"4096"`、`"true"`；完整 JSON 对象需写成转义后的字符串。路径仍受当前供应商协议约束：Anthropic 使用 `thinking`，Gemini 使用 `generationConfig.` 开头的路径。无自定义映射时填 `null`。

导入前会验证完整 JSON、字段类型、数值范围和映射路径；任何错误都不会改动模型设置。导入任意正整数上下文或输出上限后，原有下拉表单也会保留该数值供继续编辑。
