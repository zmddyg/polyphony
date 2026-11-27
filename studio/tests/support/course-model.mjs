export function modelRequest(body) {
  const input = JSON.parse(body.messages.find(message => message.role === 'user').content);
  const name = body.response_format?.json_schema?.name ?? input.phase ?? (
    input.schema?.properties?.pagePlans ? 'course_blueprint' :
    input.materials ? 'online_lesson_module' : input.candidates ? 'course_checkpoint_triage' : null
  );
  return { name, input };
}

export function modelReply(value, { finishReason = 'stop', reasoning } = {}) {
  const content = typeof value === 'string' ? value : JSON.stringify(value);
  return Response.json({ choices: [{ finish_reason: finishReason, message: {
    content, ...(reasoning && { reasoning_content: reasoning }),
  } }] });
}

export function toolReply(name, args, id = `call_${name}`, reasoning) {
  return Response.json({ choices: [{ finish_reason: 'tool_calls', message: {
    content: null, ...(reasoning && { reasoning_content: reasoning }),
    tool_calls: [{
      id, type: 'function', function: { name, arguments: JSON.stringify(args) },
    }],
  } }] });
}

export function toolResult(body, id) {
  const message = body.messages.findLast(entry => entry.role === 'tool' && entry.tool_call_id === id);
  return message ? JSON.parse(message.content) : null;
}

export function authoredPage({ pageNumber, title, archetype }, changes = {}) {
  return {
    pageNumber, title, ...(archetype && { archetype }), speakerNotes: `第 ${pageNumber} 页讲者备注`,
    blocks: [{ type: 'callout', title: '适用条件', text: '比较独立观测的结果，说明结论成立的条件。', tone: 'note' }],
    ...changes,
  };
}
