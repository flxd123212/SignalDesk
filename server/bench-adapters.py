"""One bounded instrument operation. Output is line-delimited JSON for the IDE."""
import asyncio
from contextlib import closing
import json
import math
import queue
import sys
import time


def send(*cells):
    print(json.dumps(cells, allow_nan=False), flush=True)


def seconds(opts):
    duration = float(opts.get('seconds', 8))
    if not 1 <= duration <= 120:
        raise ValueError('采集时长应为 1..120 秒')
    return duration


async def ble(action, opts):
    from bleak import BleakClient, BleakScanner
    if action == 'ble.scan':
        for device, adv in (await BleakScanner.discover(timeout=4, return_adv=True)).values():
            send(device.address, adv.local_name or device.name or '', adv.rssi)
        return
    async with BleakClient(opts['address'], timeout=12) as client:
        if action == 'ble.services':
            for service in client.services:
                for ch in service.characteristics:
                    send(service.uuid, ch.uuid, ch.handle, ', '.join(ch.properties))
            return
        ref = opts['characteristic']
        ch = client.services.get_characteristic(int(ref) if str(ref).isdecimal() else ref)
        if ch is None:
            raise ValueError('未找到特征')
        def received(_, data):
            number = ''
            if len(data) in (1, 2, 4):
                number = int.from_bytes(data, 'little', signed=False)
            send(time.time(), bytes(data).hex(' '), number)
        if action == 'ble.read':
            received(ch, await client.read_gatt_char(ch))
        elif action == 'ble.write':
            data = bytes.fromhex(opts['hex'])
            if not 1 <= len(data) <= 512:
                raise ValueError('写入长度应为 1..512 字节')
            response = 'write' in ch.properties
            await client.write_gatt_char(ch, data, response=response)
            send(ch.uuid, len(data), 'ATT response' if response else 'without response')
        else:
            await client.start_notify(ch, received)
            try:
                await asyncio.sleep(seconds(opts))
            finally:
                await client.stop_notify(ch)


def visa(action, opts):
    import pyvisa
    backend = opts.get('backend') or ''
    if backend not in ('', '@py'):
        raise ValueError('请选择系统 VISA 或 PyVISA-py')
    with closing(pyvisa.ResourceManager(backend)) as manager:
        if action == 'visa.list':
            for resource in manager.list_resources('?*'):
                send(resource)
            return
        with manager.open_resource(opts['resource']) as instrument:
            instrument.timeout = 3500
            if opts['resource'].upper().endswith('::SOCKET'):
                instrument.read_termination = '\n'
                instrument.write_termination = '\n'
            if action == 'visa.identify':
                send(opts['resource'], instrument.query('*IDN?').strip())
            elif action == 'visa.output':
                instrument.write('OUTP ON' if opts['on'] else 'OUTP OFF')
                send(opts['resource'], 'ON' if opts['on'] else 'OFF')
            else:
                command, unit = {'V': ('MEAS:VOLT:DC?', 'V'), 'A': ('MEAS:CURR:DC?', 'A')}[opts.get('unit', 'V')]
                value = float(instrument.query(command).strip())
                if not math.isfinite(value) or abs(value) >= 9e36:
                    raise ValueError('仪表过量程或返回无效读数')
                send(time.time(), value, unit, opts['resource'])


def can_capture(opts):
    import can
    interface = opts['interface']
    if interface not in ('socketcan', 'pcan'):
        raise ValueError('请选择 SocketCAN 或 PCAN')
    args = dict(interface=interface, channel=opts['channel'], fd=bool(opts.get('fd')), ignore_config=True)
    if interface == 'pcan':
        if args['fd']:
            args['timing'] = can.BitTimingFd.from_sample_point(80_000_000, int(opts['bitrate']), 80, int(opts['dataBitrate']), 80)
        else:
            args['bitrate'] = int(opts['bitrate'])
    end = time.monotonic() + seconds(opts)
    previous = {}
    with can.Bus(**args) as bus:
        while time.monotonic() < end:
            frame = bus.recv(timeout=0.12)
            if frame is None:
                continue
            key = (frame.arbitration_id, frame.is_extended_id, frame.is_remote_frame)
            period = '' if key not in previous else round((frame.timestamp - previous[key]) * 1000, 4)
            previous[key] = frame.timestamp
            kind = 'ERROR' if frame.is_error_frame else 'RTR' if frame.is_remote_frame else 'FD' if frame.is_fd else 'CAN'
            send(frame.timestamp, f'{frame.arbitration_id:0{8 if frame.is_extended_id else 3}X}', kind, frame.dlc, frame.data.hex(), period, int(frame.bitrate_switch))


def power(action, opts):
    from pyjoulescope_driver import Driver
    with Driver() as driver:
        devices = driver.device_paths()
        if action == 'power.list':
            for device in devices:
                send(device)
            return
        device = opts['joulescope']
        if device not in devices:
            raise ValueError('未找到绑定的 Joulescope')
        samples = queue.SimpleQueue()
        def on_stats(topic, value):
            sig = value['signals']
            samples.put((time.time(), *(float(sig[k]['avg']['value']) for k in ('current', 'voltage', 'power')), float(value['accumulators']['energy']['value'])))
        driver.open(device)
        topic = device + '/s/stats/value'
        try:
            is_js220 = '/js220/' in device.lower()
            if is_js220:
                driver.publish(device + '/s/i/range/mode', 'auto')
                driver.publish(device + '/s/stats/scnt', 50000)
                driver.publish(device + '/s/stats/ctrl', 1)
            else:
                driver.publish(device + '/s/i/range/select', 'auto')
                topic = device + '/s/sstats/value'
            driver.subscribe(topic, 'pub', on_stats)
            end = time.monotonic() + seconds(opts)
            while time.monotonic() < end:
                try:
                    send(*samples.get(timeout=0.2))
                except queue.Empty:
                    continue
        finally:
            driver.close(device)


def main():
    opts = json.load(sys.stdin)
    action = sys.argv[1]
    if action.startswith('ble.'):
        asyncio.run(ble(action, opts))
    elif action.startswith('visa.'):
        visa(action, opts)
    elif action == 'can.capture':
        can_capture(opts)
    elif action.startswith('power.'):
        power(action, opts)
    else:
        raise ValueError('未知采集方式')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        if isinstance(exc, ModuleNotFoundError):
            print('请在 SIGNALDESK_LAB_PYTHON 对应环境安装 bench-requirements.txt。', file=sys.stderr)
        print(str(exc) or type(exc).__name__, file=sys.stderr)
        sys.exit(1)
