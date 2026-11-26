import { getActivity } from './activities.mjs';
import { getLesson } from './catalog.mjs';
import { createRoom, reduceRoom } from './engine.mjs';

const format = 'polyphony.score';
const version = 1;
const maxLength = 128000;

function validate(lesson) {
  const id = typeof lesson?.id === 'string' ? lesson.id.trim() : '';
  const reserved = Boolean(getLesson(id));
  try {
    const activityId = reserved && !Object.hasOwn(lesson, 'activityId')
      ? getActivity({ ...lesson, id }).id
      : lesson?.activityId;
    const validated = reduceRoom(createRoom(), {
      type: 'loadLesson',
      payload: { lesson: reserved ? { ...lesson, id: 'import-' + id, activityId } : lesson },
    }).lesson;
    return { ...validated, id: reserved ? id : validated.id };
  } catch (error) {
    throw new Error('互动配置内容无法通过校验：' + error.message);
  }
}

export function exportScore(lesson) {
  return JSON.stringify({ format, version, lesson: validate(lesson) }, null, 2);
}

export function importScore(text) {
  if (typeof text !== 'string' || text.length > maxLength) throw new Error('互动配置文件超过大小限制。');
  let archive;
  try { archive = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('无法读取 JSON，请选用从共演下载的互动配置文件。'); }
  if (archive?.format !== format) throw new Error('请选择共演互动配置 JSON 文件。');
  if (archive.version !== version) throw new Error('此互动配置版本暂不可导入。');
  return validate(archive.lesson);
}
