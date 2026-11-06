"""Consulta SNMP v2c con PySNMP. Es lo único que toca la red.

Funciona con PySNMP 7.x (API asyncio snake_case) y, por las dudas, con 6.x.
"""
import config
from collector import OIDS, build_metrics

try:  # PySNMP 7.x
    from pysnmp.hlapi.v3arch.asyncio import (
        CommunityData, ContextData, ObjectIdentity, ObjectType,
        SnmpEngine, UdpTransportTarget, get_cmd)
except ImportError:  # PySNMP 6.x
    from pysnmp.hlapi.asyncio import (
        CommunityData, ContextData, ObjectIdentity, ObjectType,
        SnmpEngine, UdpTransportTarget, getCmd as get_cmd)

_NO_VALUE = {"NoSuchObject", "NoSuchInstance", "EndOfMibView"}


class SnmpError(Exception):
    """Timeout, community incorrecta u otro error de transporte/protocolo."""


_engine = None


def _get_engine():
    global _engine
    if _engine is None:
        _engine = SnmpEngine()
    return _engine


async def _target(ip):
    args = dict(timeout=config.SNMP_TIMEOUT, retries=config.SNMP_RETRIES)
    if hasattr(UdpTransportTarget, "create"):   # 7.x: constructor asíncrono
        return await UdpTransportTarget.create((ip, config.SNMP_PORT), **args)
    return UdpTransportTarget((ip, config.SNMP_PORT), **args)


def _to_int(value):
    if type(value).__name__ in _NO_VALUE:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


async def fetch_raw(ip, community):
    """Un solo GET con todos los OIDs. Devuelve {nombre: int | None}."""
    names = list(OIDS)
    objects = [ObjectType(ObjectIdentity(OIDS[n])) for n in names]
    err_indication, err_status, err_index, var_binds = await get_cmd(
        _get_engine(), CommunityData(community, mpModel=1), await _target(ip),
        ContextData(), *objects)
    if err_indication:
        raise SnmpError(str(err_indication))
    if err_status:
        raise SnmpError(f"{err_status.prettyPrint()} (OID #{int(err_index)})")
    return {name: _to_int(vb[1]) for name, vb in zip(names, var_binds)}


async def poll(server):
    """Consulta un servidor (dict con ip y comunidad) y devuelve sus métricas."""
    raw = await fetch_raw(server["ip"], server["comunidad"])
    return build_metrics(raw)
