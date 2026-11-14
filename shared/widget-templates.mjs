export const widgetTemplates = {
  number: { name: '数值与单位', code: `({
  render(ctx) {
    return { kind: 'number', title: 'SENSOR', value: ctx.inputs[0] ?? 0,
      unit: ctx.settings.unit, color: ctx.settings.color };
  }
})` },
  bar: { name: '进度条', code: `({
  render(ctx) {
    return { kind: 'bar', title: 'LEVEL', value: ctx.inputs[0] ?? 0,
      min: 0, max: 100, unit: '%', color: ctx.settings.color };
  }
})` },
  indicator: { name: '状态指示灯', code: `({
  render(ctx) {
    return { kind: 'indicator', title: 'THRESHOLD',
      value: (ctx.inputs[0] ?? 0) > 2 ? 1 : 0, color: ctx.settings.color };
  }
})` },
  button: { name: '按钮输出值', code: `({
  render(ctx) {
    return { kind: 'button', title: 'SET VALUE', value: 1,
      unit: ctx.settings.unit, color: ctx.settings.color };
  }
})` },
  chart: { name: '历史曲线', code: `({
  render(ctx) {
    const value = ctx.inputs[0] ?? 0;
    ctx.state.history = [...(ctx.state.history || []), value].slice(-200);
    return { kind: 'chart', title: 'HISTORY', value,
      series: ctx.state.history, unit: ctx.settings.unit, color: ctx.settings.color };
  }
})` },
};
