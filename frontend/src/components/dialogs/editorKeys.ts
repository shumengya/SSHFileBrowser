// 文本编辑器的按键处理:Tab 缩进、Shift+Tab 反缩进、回车保持缩进。
// 用 execCommand('insertText') 修改内容,浏览器的撤销(Ctrl+Z)才能正常工作。

export function detectIndent(text: string): string {
  const lines = text.split('\n', 2000)
  let tabs = 0
  let two = 0
  let four = 0
  for (const line of lines) {
    if (line.startsWith('\t')) tabs++
    else if (line.startsWith('    ')) four++
    else if (line.startsWith('  ')) two++
  }
  if (tabs > two + four) return '\t'
  return two > four ? '  ' : '    '
}

function insert(area: HTMLTextAreaElement, text: string) {
  // execCommand 已废弃但仍是唯一能保留撤销历史的办法;失败时退回 setRangeText
  if (!document.execCommand('insertText', false, text)) {
    area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end')
    area.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

export function handleEditorKey(event: React.KeyboardEvent<HTMLTextAreaElement>, indent: string): boolean {
  const area = event.currentTarget
  const { value, selectionStart, selectionEnd } = area
  if (event.key === 'Tab') {
    event.preventDefault()
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
    const multiLine = value.slice(selectionStart, selectionEnd).includes('\n')
    if (!multiLine && !event.shiftKey) {
      insert(area, indent)
      return true
    }
    // 多行缩进/反缩进:选中整行再整体替换
    const blockEnd = value.indexOf('\n', selectionEnd - (selectionEnd > selectionStart && value[selectionEnd - 1] === '\n' ? 1 : 0))
    const end = blockEnd < 0 ? value.length : blockEnd
    const block = value.slice(lineStart, end)
    const changed = block
      .split('\n')
      .map((line) => {
        if (!event.shiftKey) return indent + line
        if (line.startsWith('\t')) return line.slice(1)
        return line.replace(new RegExp(`^ {1,${indent === '\t' ? 4 : indent.length}}`), '')
      })
      .join('\n')
    area.setSelectionRange(lineStart, end)
    insert(area, changed)
    area.setSelectionRange(lineStart, lineStart + changed.length)
    return true
  }
  if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
    const leading = /^[ \t]*/.exec(value.slice(lineStart, selectionStart))?.[0] ?? ''
    if (!leading) return false
    event.preventDefault()
    insert(area, '\n' + leading)
    return true
  }
  return false
}

export function cursorInfo(value: string, position: number): { line: number; column: number } {
  const before = value.slice(0, position)
  const line = before.split('\n').length
  const column = position - before.lastIndexOf('\n')
  return { line, column }
}
