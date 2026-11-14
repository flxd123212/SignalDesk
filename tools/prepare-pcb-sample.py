"""Resolve exact STEP replacements and extract PCB metadata with KiCad's parser."""
import argparse
import hashlib
import json
from pathlib import Path

import pcbnew
import wx

# KiCad's font fallback notices must not open modal windows in batch exports.
log_target = wx.LogStderr()
previous_log_target = wx.Log.SetActiveTarget(log_target)


parser = argparse.ArgumentParser()
parser.add_argument('source')
parser.add_argument('output')
parser.add_argument('library')
parser.add_argument('metadata')
args = parser.parse_args()
source, output, library = Path(args.source).resolve(), Path(args.output).resolve(), Path(args.library).resolve()
if source == output:
    raise ValueError('Output must be a new working copy')
board = pcbnew.LoadBoard(str(source))
replacements, missing, footprints, suppressed = [], [], [], []
for footprint in board.GetFootprints():
    models = []
    model_vector = footprint.Models()
    for index, model in enumerate(model_vector):
        original = model.m_Filename
        resolved = original.replace('${KIPRJMOD}', source.parent.as_posix())
        for version in range(6, 11):
            resolved = resolved.replace('${KICAD%d_3DMODEL_DIR}' % version, library.as_posix())
        if original.startswith('kicad-embed://'):
            models.append({'path': original, 'shown': model.m_Show, 'embedded': True})
            continue
        candidate = Path(resolved)
        if candidate.suffix.lower() == '.wrl':
            step = candidate.with_suffix('.step')
            if step.exists():
                candidate = step
        exists = candidate.is_file()
        if exists:
            model.m_Filename = candidate.as_posix()
            model_vector[index] = model
            replacements.append({'reference': footprint.GetReference(), 'before': original, 'after': model.m_Filename})
        models.append({'path': model.m_Filename, 'shown': model.m_Show, 'exists': exists})
    # Old projects sometimes list both VRML and STEP versions of the same package.
    for index, (model, record) in enumerate(zip(model_vector, models)):
        if not record['shown'] or record.get('embedded'):
            continue
        alternatives = [other for other in models if other is not record and other['shown'] and (other.get('exists') or other.get('embedded'))]
        duplicate = any(Path(other['path']).stem.lower() == Path(record['path']).stem.lower() for other in alternatives)
        if alternatives and (not record.get('exists') or duplicate):
            model.m_Show = False
            model_vector[index] = model
            record['shown'] = False
            suppressed.append({'reference': footprint.GetReference(), 'path': record['path'], 'reason': 'unavailable or duplicate resource; another project model retained'})
        elif not record.get('exists'):
            missing.append({'reference': footprint.GetReference(), 'path': record['path']})
    position = footprint.GetPosition()
    footprints.append({
        'reference': footprint.GetReference(), 'value': footprint.GetValue(),
        'footprint': str(footprint.GetFPID().GetLibItemName()),
        'positionMm': [pcbnew.ToMM(position.x), pcbnew.ToMM(position.y)],
        'rotationDegrees': footprint.GetOrientationDegrees(), 'layer': footprint.GetLayerName(),
        'pads': [{'number': pad.GetNumber(), 'net': pad.GetNetname()} for pad in footprint.Pads()],
        'models': models,
    })
pcbnew.SaveBoard(str(output), board)
reloaded = pcbnew.LoadBoard(str(output))
saved_models = {f.GetReference(): [(m.m_Filename, m.m_Show) for m in f.Models()] for f in reloaded.GetFootprints()}
for part in footprints:
    expected = [(item['path'], item['shown']) for item in part['models']]
    if saved_models[part['reference']] != expected:
        raise RuntimeError('Model reference save verification failed: ' + part['reference'])
metadata = {
    'name': 'RoyalBlue54L Feather', 'source': str(source), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'kicadVersion': pcbnew.GetBuildVersion(), 'sourceLicense': 'CERN-OHL-P-2.0',
    'provenance': 'KiCad bundled demo / LordsBoards RoyalBlue54L Feather',
    'footprints': sorted(footprints, key=lambda item: item['reference']),
    'modelPathReplacements': replacements, 'suppressedModelEntries': suppressed, 'missingModels': missing,
    'note': 'Placement and pad nets are extracted from the supplied PCB. No electrical or mechanical validation performed.',
}
Path(args.metadata).write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding='utf-8')
print(json.dumps({'footprints': len(footprints), 'resolvedPaths': len(replacements), 'missingModels': missing}, indent=2))
