# -*- coding: utf-8 -*-
import datetime
import hashlib
import os
import time
import requests
import json

def hbh5tk(tk_cookie, enc_cookie, cookie_str):
    txt = cookie_str.replace(" ", "")
    txt = txt.replace("chushi;", "")
    if txt[-1] != ';':
        txt += ';'
    cookie_parts = txt.split(';')[:-1]
    updated = False
    for i, part in enumerate(cookie_parts):
        key_value = part.split('=')
        if key_value[0].strip() in ["_m_h5_tk", " _m_h5_tk"]:
            cookie_parts[i] = tk_cookie
            updated = True
        elif key_value[0].strip() in ["_m_h5_tk_enc", " _m_h5_tk_enc"]:
            cookie_parts[i] = enc_cookie
            updated = True

    if updated:
        return ';'.join(cookie_parts) + ';'
    else:
        return txt + tk_cookie + ';' + enc_cookie + ';'


def tq(cookie_string):
    if not cookie_string:
        return '-1'
    cookie_pairs = cookie_string.split(';')
    for pair in cookie_pairs:
        key_value = pair.split('=')
        if key_value[0].strip() in ["_m_h5_tk", " _m_h5_tk"]:
            return key_value[1]
    return '-1'


def tq1(txt):
    try:
        txt = txt.replace(" ", "")
        if txt[-1] != ';':
            txt += ';'
        pairs = txt.split(";")[:-1]
        ck_json = {}
        for pair in pairs:
            key, value = pair.split("=", 1)
            ck_json[key] = value
        return ck_json
    except Exception as e:
        print(f'❎Cookie解析错误: {e}')
        return {}


def md5(text):
    hash_md5 = hashlib.md5()
    hash_md5.update(text.encode())
    return hash_md5.hexdigest()


def check_cookie(cookie):
    url = "https://waimai-guide.ele.me/h5/mtop.alsc.personal.queryminecenter/1.0/?jsv=2.6.2&appKey=12574478"
    headers = {
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/50.0.2661.87 Safari/537.36"
    }

    try:
        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            cookie_jar = response.cookies
            token = cookie_jar.get('_m_h5_tk', '')
            token_cookie = "_m_h5_tk=" + token
            enc_token = cookie_jar.get('_m_h5_tk_enc', '')
            enc_token_cookie = "_m_h5_tk_enc=" + enc_token
            cookie = hbh5tk(token_cookie, enc_token_cookie, cookie)
            return cookie
        else:
            return None
    except Exception as e:
        print("解析ck错误")
        return None


def xq(ck1):
    cookie = check_cookie(ck1)
    headers = {
        "authority": "shopping.ele.me",
        "accept": "application/json",
        "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "cache-control": "no-cache",
        "content-type": "application/x-www-form-urlencoded",
        "cookie": cookie,
        "user-agent": "Mozilla/5.0 (Linux; Android 8.0.0; SM-G955U Build/R16NW) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.141 Mobile Safari/537.36"
    }

    ck = tq1(ck1)
    deviceId = ck.get("deviceId")
    userId = ck.get("USERID")
    token = ck.get("token")
    if not token:
        message = f"无刷新token，无法刷新"
        print(message)
        return
    umt = ck.get("umt")
    data = {
        "ext": "{\"apiReferer\":\"{\\\\\\\"eventName\\\\\\\":\\\\\\\"SESSION_INVALID\\\\\\\"}\"}",
        'userId': userId,
        'tokenInfo': '{"appName":"24895413","appVersion":"android_11.1.38","deviceId":"' + deviceId + '","deviceName":"Android(AOSP on blueline)","locale":"zh_CN","sdkVersion":"android_5.3.3.4","site":25,"t":' + str(
            int(time.time() * 1000)) + ',"token":"' + token + '","ttid":"1608030065155@eleme_android_11.1.38","useAcitonType":true,"useDeviceToken":false,"utdid":""}',
        'riskControlInfo': '{"appStore":"1608030065155@eleme_android_11.1.38","deviceBrand":"Google","deviceModel":"AOSP on blueline","deviceName":"AOSP on blueline","osName":"android","osVersion":"10","screenSize":"0x0","t":"' + str(
            int(time.time() * 1000)) + '","umidToken":"' + umt + '","wua":""}'}
    timestamp = int(time.time() * 1000)
    data_str = json.dumps(data)
    token = tq(cookie)
    token_part = token.split("_")[0]

    sign_str = f"{token_part}&{timestamp}&12574478&{data_str}"
    sign = md5(sign_str)
    url = f"https://guide-acs.m.taobao.com/h5/com.taobao.mtop.mloginunitservice.autologin/1.0/?jsv=2.6.1&appKey=12574478&t={timestamp}&sign={sign}&api=com.taobao.mtop.mloginunitservice.autologin&v=1.0&type=originaljson&dataType=json"
    r = requests.post(url, headers=headers, data={'data': data_str})
    jsonData = r.json()
    if 'code' in jsonData['data'] and jsonData['data']['code'] == 3000:
        expirationTime = json.loads(jsonData["data"]["returnValue"]["data"])["expires"]
        formattedTime = datetime.datetime.fromtimestamp(expirationTime).strftime('%Y-%m-%d %H:%M:%S')
        print(f"刷新成功，过期时间：{formattedTime}")
    else:
        print(f"刷新失败，{jsonData['ret'][0]}")


ck1 = os.environ.get('elmck')
cookies = ck1.split("&")
print(f"饿了么共获取到 {len(cookies)} 个账号")
for i, ck in enumerate(cookies):
    print(f"======开始第{i + 1}个账号======")
    xq(ck)
    print("2s后进行下一个账号")
    time.sleep(2)
