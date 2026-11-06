"""Prueba el código de snmp_client.py con un PySNMP simulado.

Verifica el mapeo de valores, los errores y la compatibilidad 7.x / 6.x.
NO prueba la librería real ni un agente snmpd: eso solo se puede probar en Docker.
"""
import asyncio
import importlib
import os
import sys
import types
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import collector  # noqa: E402


class NoSuchInstance:      # mismo nombre de clase que usa pysnmp (rfc1905)
    pass


class Gauge32(int):
    pass


class Bindings:
    """Respuesta programable del 'agente'."""
    values = {}
    error_indication = None
    error_status = None
    calls = []


class ObjectType:
    def __init__(self, identity, value=None):
        self.oid = identity.oid
        self.value = value

    def __getitem__(self, i):
        return (self.oid, self.value)[i]


class ObjectIdentity:
    def __init__(self, oid):
        self.oid = oid


class _Status:
    def prettyPrint(self):
        return "authorizationError"


async def _get(engine, community, target, context, *objects):
    Bindings.calls.append({"community": community.args, "target": target.args, "oids": [o.oid for o in objects]})
    if Bindings.error_indication:
        return Bindings.error_indication, None, 0, []
    if Bindings.error_status:
        return None, _Status(), 2, []
    return None, None, 0, [ObjectType(ObjectIdentity(o.oid), Bindings.values.get(o.oid, NoSuchInstance())) for o in objects]


class CommunityData:
    def __init__(self, name, mpModel=None):
        self.args = (name, mpModel)


class ContextData:
    pass


class SnmpEngine:
    pass


class Target7:
    def __init__(self, addr, timeout, retries):
        self.args = (addr, timeout, retries)

    @classmethod
    async def create(cls, addr, timeout=1, retries=5):   # 7.x: constructor asíncrono
        return cls(addr, timeout, retries)


class Target6:
    def __init__(self, addr, timeout=1, retries=5):      # 6.x: constructor normal
        self.args = (addr, timeout, retries)


def install_fake(version):
    for name in [m for m in sys.modules if m == "pysnmp" or m.startswith("pysnmp.")]:
        del sys.modules[name]
    common = dict(CommunityData=CommunityData, ContextData=ContextData, ObjectIdentity=ObjectIdentity,
                  ObjectType=ObjectType, SnmpEngine=SnmpEngine)
    pkg = types.ModuleType("pysnmp")
    hlapi = types.ModuleType("pysnmp.hlapi")
    sys.modules.update({"pysnmp": pkg, "pysnmp.hlapi": hlapi})
    if version == 7:
        v3 = types.ModuleType("pysnmp.hlapi.v3arch")
        mod = types.ModuleType("pysnmp.hlapi.v3arch.asyncio")
        mod.__dict__.update(common, UdpTransportTarget=Target7, get_cmd=_get)
        sys.modules.update({"pysnmp.hlapi.v3arch": v3, "pysnmp.hlapi.v3arch.asyncio": mod})
    else:
        mod = types.ModuleType("pysnmp.hlapi.asyncio")
        mod.__dict__.update(common, UdpTransportTarget=Target6, getCmd=_get)
        sys.modules["pysnmp.hlapi.asyncio"] = mod
    sys.modules.pop("snmp_client", None)
    return importlib.import_module("snmp_client")


FULL = {
    collector.OIDS["uptime_ticks"]: 8_640_000,
    collector.OIDS["cpu_idle"]: Gauge32(70),
    collector.OIDS["mem_total"]: 4_000_000,
    collector.OIDS["mem_avail"]: 1_000_000,
    collector.OIDS["mem_buffer"]: 200_000,
    collector.OIDS["mem_cached"]: 800_000,
    collector.OIDS["disk_pct"]: 63,
}
SERVER = {"ip": "10.0.0.1", "comunidad": "lab"}


class SnmpClientTests(unittest.TestCase):
    def setUp(self):
        Bindings.values, Bindings.error_indication, Bindings.error_status, Bindings.calls = dict(FULL), None, None, []

    def run_poll(self, client):
        return asyncio.run(client.poll(SERVER))

    def test_pysnmp_7(self):
        client = install_fake(7)
        m = self.run_poll(client)
        self.assertEqual(m, {"cpu": 30.0, "ram": 50.0, "disco": 63.0, "uptime": 86400})
        call = Bindings.calls[0]
        self.assertEqual(call["community"], ("lab", 1))                 # v2c
        self.assertEqual(call["target"][0], ("10.0.0.1", 161))
        self.assertEqual(call["oids"], list(collector.OIDS.values()))  # un solo GET con todos

    def test_pysnmp_6_compatible(self):
        client = install_fake(6)
        self.assertEqual(self.run_poll(client)["cpu"], 30.0)

    def test_oid_inexistente_queda_en_none(self):
        client = install_fake(7)
        del Bindings.values[collector.OIDS["disk_pct"]]
        self.assertIsNone(self.run_poll(client)["disco"])

    def test_vista_restringida_es_error_de_configuracion(self):
        client = install_fake(7)
        del Bindings.values[collector.OIDS["cpu_idle"]]
        with self.assertRaises(collector.IncompleteData):
            self.run_poll(client)

    def test_timeout(self):
        client = install_fake(7)
        Bindings.error_indication = "No SNMP response received before timeout"
        with self.assertRaises(client.SnmpError) as cm:
            self.run_poll(client)
        self.assertIn("timeout", str(cm.exception))

    def test_error_de_protocolo(self):
        client = install_fake(7)
        Bindings.error_status = True
        with self.assertRaises(client.SnmpError) as cm:
            self.run_poll(client)
        self.assertIn("authorizationError", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
