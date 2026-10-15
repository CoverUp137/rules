//<script>
/*
 * ============================================================================
 *  UFI-TOOLS 插件：CLNC 网络代理（CuteBi Linux Network Client）
 *  ----------------------------------------------------------------------------
 *  适配设备：中兴 F50（Android 13）+ UFI-TOOLS（需要开启高级功能 / root）
 *  核心来源：https://github.com/mmmdbybyd/CLNC
 *  安装目录：/data/CLNC
 *      Core/clnc        CLNC 内核（arm64 静态）
 *      Core/MLBox       联网检测 / DNS 工具
 *      Core/CuteBi      Android 启动脚本（tun + iptables + ip rule）
 *      config.ini       主配置（modeName / 内核模式 / ipv6 / 放行项）
 *      *.conf           模式配置（clnc_bd / clnc_uc / clnc_wk ...）
 *      service.sh       本插件生成的服务脚本 start|stop|restart|status
 *      clnc.log         运行日志
 *  说明：utils.js 中的函数为全局注册，这里直接使用（runShellWithRoot /
 *        createToast / createSwitch / collapseGen / requestInterval /
 *        checkAdvancedFunc / saveConfig / uploadFileKano ...），不重复造轮子。
 * ============================================================================
 */
(async () => {

    /* ============================== 常量 ============================== */
    const BASE = '/data/CLNC'
    const CORE = BASE + '/Core'
    const LOG_FILE = BASE + '/clnc.log'
    const PID_FILE = CORE + '/clnc.pid'
    const SERVICE = BASE + '/service.sh'
    const INI_FILE = BASE + '/config.ini'
    const BOOT_SH = '/sdcard/ufi_tools_boot.sh'
    const BOOT_LINE = SERVICE + ' start boot'
    const COLLAPSE_ID = '#collapse_CLNC'
    const STOR_KEY = '#collapse_CLNC'

    const APP_FILES = '/data/data/com.minikano.f50_sms/files'
    const APP_CURL = APP_FILES + '/curl'
    const UPLOAD_DIR = APP_FILES + '/uploads'

    const TMP_DIR = '/data/CLNC_tmp'
    const TMP_ZIP = '/data/CLNC_install.zip'
    // 只使用仓库里的 tun 版核心（CuteBi 会自己建 tun、写 iptables/路由规则）
    const ZIP_NAME = 'clnc-1.2-magisk.zip'
    const RAW_URL = 'https://raw.githubusercontent.com/mmmdbybyd/CLNC/master/androidScript/' + ZIP_NAME
    // 内置镜像（依次尝试，都失败可在界面里自定义下载地址）
    const MIRRORS = [
        'https://gh-proxy.com/' + RAW_URL,
        'https://ghfast.top/' + RAW_URL,
        'https://hub.gitmirror.com/' + RAW_URL,
        'https://cdn.jsdelivr.net/gh/mmmdbybyd/CLNC@master/androidScript/' + ZIP_NAME,
        'https://ghproxy.net/' + RAW_URL,
        RAW_URL,
    ]
    const URL_KEY = 'clnc_custom_url'
    const SH_KEY = 'clnc_custom_script'
    const ONLY_CUSTOM_KEY = 'clnc_only_custom'
    const CUSTOM_SH_PATH = '/data/CLNC_custom.sh'
    const CNS_DIR = BASE + '/makeCNSMode'
    const GEN_SH = CNS_DIR + '/gen.sh'

    let LOG_INTERVAL = null
    let POLL_TIMER = null
    let INI_DIRTY = false
    let CUR_MODE = ''
    let CONF_DIRTY = false
    let CONF_FORCE = false
    let DL_TOOL = null

    if (document.querySelector('#IFRAME_CLNC')) return

    /* ============================== 服务脚本 ============================== */
    /* 由插件写入 /data/CLNC/service.sh，也可手动执行：sh service.sh start */
    const SERVICE_SH = `#!/system/bin/sh
# ==========================================================
#  CLNC 服务脚本（由 UFI-TOOLS 的 CLNC 插件生成 / 维护）
#  用法: service.sh {start|stop|restart|status} [boot]
# ==========================================================
BASE=/data/CLNC
CORE=$BASE/Core
LOG=$BASE/clnc.log
PIDF=$CORE/clnc.pid

get_pid() { [ -f "$PIDF" ] && tr -dc '0-9' < "$PIDF" 2>/dev/null; }

is_running() {
    p=$(get_pid)
    [ -n "$p" ] && [ -d "/proc/$p" ]
}

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

rotate_log() {
    [ -f "$LOG" ] || return 0
    s=$(wc -c < "$LOG" 2>/dev/null)
    [ -n "$s" ] && [ "$s" -gt 262144 ] && { tail -c 131072 "$LOG" > "$LOG.tmp"; mv "$LOG.tmp" "$LOG"; }
}

start_bg() {
    if command -v setsid >/dev/null 2>&1; then
        setsid sh -c "cd '$CORE' && ./CuteBi start >>'$LOG' 2>&1" >/dev/null 2>&1 &
    else
        sh -c "cd '$CORE' && ./CuteBi start >>'$LOG' 2>&1" >/dev/null 2>&1 &
    fi
}

stop_bg() {
    if command -v setsid >/dev/null 2>&1; then
        setsid sh -c "cd '$CORE' && ./CuteBi stop >>'$LOG' 2>&1" >/dev/null 2>&1 &
    else
        sh -c "cd '$CORE' && ./CuteBi stop >>'$LOG' 2>&1" >/dev/null 2>&1 &
    fi
}

# 等默认路由出现（最多 60 秒）；开机自启模式下在 sleep 15 之后调用
wait_network() {
    i=0
    while [ $i -lt 30 ]; do
        ip route 2>/dev/null | grep -q '^default' && return 0
        sleep 2
        i=$((i+1))
    done
    return 0
}

do_start() {
    if is_running; then echo "CLNC 已在运行 (pid $(get_pid))"; return 0; fi
    if [ ! -x "$CORE/clnc" ]; then echo "未找到内核 $CORE/clnc，请先在插件里安装核心"; return 1; fi
    command -v iptables >/dev/null 2>&1 || echo "警告: 未找到 iptables，代理可能无法生效"
    [ -e /dev/tun ] || [ -e /dev/net/tun ] || echo "警告: 未找到 /dev/tun，tun 模式可能不可用"
    rotate_log
    log "===== 启动 CLNC ====="
    start_bg
    echo "已发出启动命令，请稍后查看「运行状态」与「运行日志」"
}

do_stop() {
    if is_running; then
        log "===== 停止 CLNC ====="
        stop_bg
        echo "已发出停止命令（后台清理 iptables / 路由规则）"
    else
        log "===== 清理残留规则 ====="
        stop_bg
        echo "CLNC 未在运行，已执行一次残留规则清理"
    fi
}

case "$1" in
    start)
        # 开机自启（$2 = boot）：刚开机时系统、网络、存储都还没就绪，
        # 先睡 15 秒再等默认路由出现，然后才启动核心
        if [ "$2" = "boot" ]; then
            log "===== 开机自启：等待 15 秒后启动 ====="
            echo "开机自启：等待 15 秒再启动 CLNC..."
            sleep 15
            wait_network
        fi
        do_start
        ;;
    stop)
        do_stop
        ;;
    restart)
        do_stop
        i=0
        while is_running && [ $i -lt 30 ]; do sleep 1; i=$((i+1)); done
        sleep 2
        do_start
        ;;
    status)
        if is_running; then echo "RUNNING $(get_pid)"; else echo "STOPPED"; fi
        ;;
    *)
        echo "用法: $0 {start|stop|restart|status} [boot]"
        ;;
esac
`

    /* 屏蔽 CuteBi 每次启动时去 binary.quicknet.cyou 在线更新核心，改为插件手动更新 */
    const DOWNLOAD_CORES_SH = `#!/system/bin/sh
# 由 UFI-TOOLS 的 CLNC 插件接管：禁用内核在线自动更新（避免启动卡在网络请求上）
# 需要更新内核时，请在插件里点「安装/更新核心」
exit 0
`

    /* CNS 模式配置生成器：把官方 makeCNSMode/makeConfFile 包一层，用参数传配置槽，避免在命令里写中文文件名
       用法: gen.sh <全局配置槽> <国内分流槽|-> <输出名>     例: gen.sh cns_1 - clnc_cns */
    const GEN_SH_TEXT = `#!/system/bin/sh
# ==========================================================
#  CNS 模式配置生成器（由 UFI-TOOLS 的 CLNC 插件生成 / 维护）
#  用法: gen.sh <全局配置槽> <国内分流槽|-> <输出名>
#  例:   gen.sh cns_1 - clnc_cns
#  依赖同目录: makeConfFile / tcpAcl_CH_ips.list / tcpAcl_CH_domains.list / dnsAcl_CH_domains.list
# ==========================================================

# makeConfFile 用 echo -E 往配置里写 \r\n 这类转义，必须原样保留。
# 不同 ROM / 不同 sh 对 echo -E 的支持不一致（dash、部分 busybox 会当成普通参数），
# 所以这里自己实现 echo，保证生成结果与 shell 无关。
echo() {
    case "$1" in
        -E) shift;;
        -e) shift; printf '%b\n' "$*"; return 0;;
        -n|-En|-nE) shift; printf '%s' "$*"; return 0;;
    esac
    printf '%s\n' "$*"
}

GLOBAL_CFG="$1"
CH_CFG="$2"
OUT_NAME="$3"
BASE=/data/CLNC
DIR=$BASE/makeCNSMode

[ "$CH_CFG" = "-" ] && CH_CFG=""
case "$OUT_NAME" in
    ''|*/*|*..*) echo "输出名不合法（只能是字母数字 . _）"; exit 1;;
esac
[ -f "$DIR/makeConfFile" ] || { echo "缺少 $DIR/makeConfFile，请先安装/更新核心"; exit 1; }
[ -f "$DIR/$GLOBAL_CFG.ini" ] || { echo "缺少 $DIR/$GLOBAL_CFG.ini（先在插件里保存参数）"; exit 1; }
if [ -n "$CH_CFG" ] && [ ! -f "$DIR/$CH_CFG.ini" ]; then echo "缺少 $DIR/$CH_CFG.ini"; exit 1; fi

cd "$DIR" || exit 1
cnsGlobalConfigs="$GLOBAL_CFG"
cnsCHConfigs="$CH_CFG"
configName="$OUT_NAME"
. ./makeConfFile
OUT="$BASE/$OUT_NAME.conf"
[ -s "$OUT" ] || { echo "生成失败：$OUT 为空"; exit 1; }
# 上游 makeConfFile 把 firstMatch 写成了 firstMach，这里修正
sed -i 's/firstMach/firstMatch/g' "$OUT"
# 兜底：万一还有 echo 变异留下的 "-E " 行前缀
sed -i 's/^-E //' "$OUT"
grep -q 'tcp::Global' "$OUT" || { echo "生成的文件内容异常"; exit 1; }
echo "已生成 $OUT（$(wc -c < "$OUT" | tr -d ' ') 字节）"
`

    /* ============================== 通用工具 ============================== */
    const $ = (sel) => document.querySelector(sel)

    const sh = async (cmd, timeout) => {
        try {
            const res = timeout ? await runShellWithRoot(cmd, timeout) : await runShellWithRoot(cmd)
            return {
                success: Boolean(res && res.success),
                content: ((res && res.content) || '').toString().trim(),
            }
        } catch (e) {
            console.error('[CLNC] shell 异常:', cmd, e)
            return { success: false, content: '' }
        }
    }

    const toast = (text, color = '', delay = 3000) => createToast(text, color, delay)

    const checkRoot = async () => {
        try {
            if (typeof checkAdvancedFunc === 'function') return Boolean(await checkAdvancedFunc())
        } catch (e) { }
        const res = await sh('whoami')
        return res.content.includes('root')
    }

    const checkWeakToken = () => {
        try {
            if (!SHA256 || !KANO_TOKEN) return false
            const list = ['admin', 'password', '666', '6666', '12345', '123456',
                '1234567', '12345678', '123456789', '1234567890', 'root']
            return list.some((tk) => SHA256(tk) == KANO_TOKEN.toUpperCase())
        } catch (e) { return false }
    }

    const isInstall = async () => {
        const res = await sh('ls ' + CORE + '/clnc ' + CORE + '/CuteBi')
        return res.content.includes('CuteBi')
    }

    /* 上传文本并落地到目标路径（优先用 utils.js 的 saveConfig） */
    const uploadAndMove = async (file, targetPath) => {
        try {
            if (typeof saveConfig === 'function') {
                if (!(await saveConfig(file, targetPath))) return false
            } else {
                const formData = new FormData()
                formData.append('file', file)
                const res = await (await fetch(KANO_baseURL + '/upload_img', {
                    method: 'POST',
                    headers: common_headers,
                    body: formData,
                })).json()
                if (!res || !res.url) return false
                const mv = await sh('mv ' + APP_FILES + res.url + ' ' + targetPath)
                if (!mv.success) return false
            }
            await sh('chmod 666 ' + targetPath)
            return true
        } catch (e) {
            console.error('[CLNC] 写入失败:', targetPath, e)
            return false
        }
    }

    const saveTextFile = async (text, filename, targetPath) => {
        const file = new File([text], filename, { type: 'text/plain' })
        return await uploadAndMove(file, targetPath)
    }

    /* config.ini 简易读写 */
    const parseIni = (text) => {
        const data = {}
        String(text || '').split('\n').forEach((line) => {
            const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
            if (!m) return
            let v = m[2].trim()
            if (/^'.*'$/.test(v) || /^".*"$/.test(v)) v = v.slice(1, -1)
            data[m[1]] = v
        })
        return data
    }

    const setIniValue = (text, key, value) => {
        const re = new RegExp('^[ \\t]*' + key + '[ \\t]*=.*$', 'm')
        const line = key + "='" + value + "'"
        if (re.test(text)) return text.replace(re, line)
        return text.replace(/\s*$/, '\n') + line + '\n'
    }

    /* ============================== 状态 / 日志 ============================== */
    const getStatus = async () => {
        const res = await sh('pid=$(cat ' + PID_FILE + ' 2>/dev/null | tr -dc 0-9); ' +
            'if [ -n "$pid" ] && [ -d /proc/$pid ]; then echo RUN:$pid; else echo STOP; fi')
        const running = res.content.startsWith('RUN')
        return { running, pid: running ? res.content.split(':')[1] : '' }
    }

    /* 一次 shell 调用拿全部状态：安装/运行/环境/版本/config.ini 全文/*.conf 列表 */
    const renderStatus = async () => {
        const cmd = 'P=' + PID_FILE + '; C=' + CORE + '; I=' + INI_FILE + '; B=' + BASE + '; ' +
            '[ -x $C/clnc ] && echo INST:1 || echo INST:0; ' +
            'p=$(cat $P 2>/dev/null | tr -dc 0-9); ' +
            '[ -n "$p" ] && [ -d /proc/$p ] && echo RUN:$p || echo RUN:-; ' +
            '[ -e /dev/tun ] && echo -n "TUN "; [ -e /dev/net/tun ] && echo -n "TUNNET "; ' +
            'command -v iptables >/dev/null 2>&1 && echo -n "IPT "; ' +
            'command -v ip >/dev/null 2>&1 && echo -n "IPBIN "; echo ENVEND; ' +
            '[ -x $C/clnc ] && timeout 3s $C/clnc -v 2>&1 | head -n 20; ' +
            'timeout 2s awk \'{print}\' $I 2>/dev/null; ' +
            'echo CONFLIST; ls $B/*.conf 2>/dev/null; echo CONFLISTEND'
        const res = await sh(cmd, 20000)
        const lines = res.content.split('\n').map((x) => x.trim()).filter(Boolean)
        const installed = lines.indexOf('INST:1') >= 0
        const runLine = lines.filter((x) => x.indexOf('RUN:') === 0)[0] || 'RUN:-'
        const pid = runLine.replace('RUN:', '')
        const running = Boolean(pid) && pid !== '-'
        const envLine = lines.filter((x) => x.indexOf('ENVEND') >= 0)[0] || ''
        const envIdx = lines.indexOf(envLine)
        const confA = lines.indexOf('CONFLIST')
        const confB = lines.indexOf('CONFLISTEND')
        const confs = confA >= 0 && confB > confA ? lines.slice(confA + 1, confB) : []
        // clnc -v 输出是多行横幅（猫脸 + 版本 + 作者 + 邮箱），只截取横幅区再挑版本号
        let ver = '-'
        if (installed && envIdx >= 0) {
            const banner = []
            for (let i = envIdx + 1; i < lines.length; i++) {
                const x = lines[i]
                if (x === 'CONFLIST' || x.indexOf('#') === 0 || /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(x)) break
                banner.push(x)
            }
            const txt = banner.join(' ').slice(0, 400)
            const m = txt.match(/Client\(([0-9][0-9.]*)\)/) ||
                txt.match(/([0-9]+\.[0-9]+(?:\.[0-9]+)?)/) ||
                (txt.indexOf('CuteBi') >= 0 ? ['', 'CuteBi'] : null)
            if (m) ver = 'clnc ' + m[1]
        }
        const ini = parseIni(lines.filter((x) => /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(x)).join('\n'))
        const mode = ini.modeName || ''
        let modeOk = '-'
        if (mode) modeOk = confs.some((x) => x.endsWith('/' + mode + '.conf')) ? '已就绪' : '缺配置！'

        const setTxt = (id, txt) => { const el = $(id); if (el) el.textContent = txt }
        const runEl = $('#clnc_status_run')
        if (runEl) {
            runEl.textContent = !installed ? '未安装' : (running ? '运行中 pid ' + pid : '未运行')
            runEl.style.color = !installed ? '#ff6b6b' : (running ? 'var(--dark-btn-color-active)' : '#ff9f43')
        }
        setTxt('#clnc_status_ver', installed ? (ver || '-') : '-')
        setTxt('#clnc_status_mode', mode ? mode + '（' + modeOk + '）' : '-')
        const envs = []
        envs.push(envLine.indexOf('TUN') >= 0 ? 'tun ✓' : 'tun ✗')
        envs.push(envLine.indexOf('IPT') >= 0 ? 'iptables ✓' : 'iptables ✗')
        envs.push(envLine.indexOf('IPBIN') >= 0 ? 'ip ✓' : 'ip ✗')
        setTxt('#clnc_status_env', envs.join(' '))
        const envEl = $('#clnc_status_env')
        if (envEl) envEl.style.color = envs.some((x) => x.indexOf('✗') >= 0) ? '#ff9f43' : ''
        const dot = $('#clnc_dot')
        if (dot) dot.style.color = !installed ? '#ff6b6b' : (running ? 'var(--dark-btn-color-active)' : '#ff9f43')
        setTxt('#clnc_head_state', !installed ? '未安装核心' : (running ? '运行中' : '未运行'))
        setTxt('#clnc_hint', !installed ? '先点「安装/更新核心」' : (running ? '' : '点「启动」生效'))
        const state = { installed, running, pid, mode, confs }
        try { if (typeof updateButtonStates === 'function') updateButtonStates(state) } catch (e) { }
        return state
    }

    const readLog = async () => {
        const el = $('#clnc_log_text')
        if (!el) return
        const res = await sh('timeout 2s awk \'{print}\' ' + LOG_FILE + ' | tail -n 60')
        const text = res.content || '（暂无日志）'
        if (el.value === text) return
        el.value = text
        el.scrollTop = el.scrollHeight
    }

    /* ============================== 核心下载 / 安装 ============================== */
    const getDownloadTool = async () => {
        if (DL_TOOL) return DL_TOOL
        const res = await sh('[ -x ' + APP_CURL + ' ] && echo curl:' + APP_CURL + '; ' +
            'command -v curl >/dev/null 2>&1 && echo curl:$(command -v curl); ' +
            'command -v wget >/dev/null 2>&1 && echo wget:$(command -v wget); echo')
        const line = (res.content.split('\n')[0] || '').trim()
        if (!line) return null
        const idx = line.indexOf(':')
        DL_TOOL = { kind: line.slice(0, idx), path: line.slice(idx + 1) }
        return DL_TOOL
    }

    const downloadFile = async (url, out, minSize) => {
        const tool = await getDownloadTool()
        if (!tool) return false
        const cmd = tool.kind === 'wget'
            ? 'timeout 70 ' + tool.path + ' -q -O ' + out + ' "' + url + '"'
            : 'timeout 70 ' + tool.path + ' -L -s --connect-timeout 6 -m 60 -o ' + out + ' "' + url + '"'
        await sh('rm -f ' + out)
        await sh(cmd, 110 * 1000)
        const sizeRes = await sh('wc -c < ' + out + ' 2>/dev/null')
        const size = parseInt(sizeRes.content || '0', 10)
        return size > (minSize === undefined ? 300000 : minSize)
    }

    const downloadCore = async () => {
        const custom = (localStorage.getItem(URL_KEY) || '').trim()
        const onlyCustom = localStorage.getItem(ONLY_CUSTOM_KEY) === '1'
        const urls = custom ? (onlyCustom ? [custom] : [custom].concat(MIRRORS)) : MIRRORS
        if (!urls.length) return false
        for (let i = 0; i < urls.length; i++) {
            const url = urls[i]
            toast('正在下载核心（' + (i + 1) + '/' + urls.length + '）：' + url.slice(0, 42) + '...', '', 4000)
            const ok = await downloadFile(url, TMP_ZIP)
            if (ok) return true
        }
        return false
    }

    const extractZip = async (zipPath, destDir) => {
        const candidates = [
            'unzip',
            'busybox unzip',
            'toybox unzip',
            APP_FILES + '/busybox unzip',
        ]
        for (const c of candidates) {
            const res = await sh('sh -c "command -v ' + c.split(' ')[0] + ' >/dev/null 2>&1 || exit 9; ' +
                c + ' -o ' + zipPath + ' -d ' + destDir + ' >/dev/null 2>&1 || exit 8; echo OK"')
            if (res.content.includes('OK')) return true
        }
        return false
    }

    /* 解压后把 clnc_magisk 目录整体搬到 /data/CLNC */
    const installFromZip = async (zipPath) => {
        await sh('rm -rf ' + TMP_DIR + ' && mkdir -p ' + TMP_DIR)
        const ok = await extractZip(zipPath, TMP_DIR)
        if (!ok) {
            await sh('rm -rf ' + TMP_DIR)
            toast('解压失败：缺少 unzip/busybox 或压缩包损坏，请安装 busybox 或用「本地安装」', 'red', 6000)
            return false
        }
        const findRes = await sh('find ' + TMP_DIR + ' -type f -path "*/Core/clnc" 2>/dev/null | head -n 1')
        const found = (findRes.content.split('\n')[0] || '').trim()
        if (!found || !found.endsWith('/Core/clnc')) {
            await sh('rm -rf ' + TMP_DIR)
            toast('压缩包内容不匹配，未找到 Core/clnc', 'red', 5000)
            return false
        }
        const srcDir = found.replace(/\/Core\/clnc$/, '')

        // 覆盖安装前先停一次，避免内核文件被占用
        if (await getStatus().then((s) => s.running)) {
            await sh(SERVICE + ' stop', 20000)
            await new Promise((r) => setTimeout(r, 4000))
        }

        // 1) 内核目录：整个重建（这才叫“更新核心”，Core 里没有用户数据）
        await sh('mkdir -p ' + BASE)
        await sh('rm -rf ' + BASE + '/Core')
        await sh('cp -af ' + srcDir + '/Core ' + BASE + '/')
        // 2) config.ini 与模式配置：已存在就不覆盖，避免更新时丢掉自己的配置
        await sh('[ -f ' + BASE + '/config.ini ] || cp -af ' + srcDir + '/config.ini ' + BASE + '/')
        const confsRes = await sh('ls ' + srcDir + '/*.conf 2>/dev/null')
        for (const f of confsRes.content.split('\n').map((x) => x.trim()).filter(Boolean)) {
            const name = f.split('/').pop()
            await sh('[ -f ' + BASE + '/' + name + ' ] || cp -af ' + f + ' ' + BASE + '/' + name)
        }
        // 3) 附带脚本与 makeCNSMode 工具目录
        await sh('for f in start.sh stop.sh status.sh makeCNSMode; do ' +
            '[ -e ' + srcDir + '/$f ] && cp -af ' + srcDir + '/$f ' + BASE + '/$f; done')
        await sh('rm -rf ' + TMP_DIR + ' ' + zipPath)
        await sh('chmod -R 777 ' + BASE)
        const verify = await sh('[ -f ' + CORE + '/clnc ] && [ -f ' + CORE + '/CuteBi ] && ' +
            '[ -f ' + INI_FILE + ' ] && echo VERIFY_OK')
        if (!verify.content.includes('VERIFY_OK')) {
            toast('安装失败，请检查 /data 空间与 root 权限', 'red', 5000)
            return false
        }
        // 写入本插件的服务脚本，并屏蔽内核在线自动更新
        await saveTextFile(SERVICE_SH, 'service.sh', SERVICE)
        await saveTextFile(DOWNLOAD_CORES_SH, 'downloadCores.sh', CORE + '/downloadCores.sh')
        await sh('chmod 777 ' + SERVICE + ' ' + CORE + '/downloadCores.sh ' + CORE + '/CuteBi ' + CORE + '/clnc ' + CORE + '/MLBox')
        return true
    }

    let installCount = 0
    let installTimer = null
    const doInstall = async (zipPathFromLocal) => {
        if (checkWeakToken()) {
            return toast('检测到你的 UFI-TOOLS 使用了弱口令，为了安全请先改成复杂口令！', 'red', 8000)
        }
        if (!(await checkRoot())) return toast('没有开启高级功能（root），无法使用！', 'red', 5000)

        const installed = await isInstall()
        if (installed && !zipPathFromLocal) {
            installTimer && clearTimeout(installTimer)
            installTimer = setTimeout(() => { installCount = 0 }, 6000)
            if (installCount++ < 1) {
                return toast('CLNC 已安装，再点一次「安装/更新核心」将覆盖安装', 'pink', 5000)
            }
            installCount = 0
        }

        let zipPath = zipPathFromLocal
        if (!zipPath) {
            toast('开始下载 CLNC 核心（约 2.7MB）...', '', 4000)
            if (!(await downloadCore())) {
                return toast('下载失败，可在界面顶部自定义下载地址，或使用「本地安装」', 'red', 8000)
            }
            zipPath = TMP_ZIP
        }

        toast('正在解压安装...', '')
        const ok = await installFromZip(zipPath)
        if (!ok) return

        toast(installed ? 'CLNC 核心更新完成' : 'CLNC 安装完成，点击「启动」即可生效', 'green', 6000)
        INI_DIRTY = false
        await refreshConfList()
        await refreshAll(true)
    }

    const doLocalInstall = () => {
        if (typeof uploadFileKano !== 'function') {
            return toast('当前 UFI-TOOLS 版本不支持本地安装，请使用在线安装', 'red', 5000)
        }
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.zip'
        input.style.display = 'none'
        document.body.appendChild(input)
        input.onchange = async () => {
            const f = input.files && input.files[0]
            input.remove()
            if (!f) return
            toast('正在上传 ' + f.name + ' ...', '')
            const name = await uploadFileKano(f)
            if (!name) return toast('上传失败', 'red')
            await doInstall(UPLOAD_DIR + '/' + name)
        }
        input.click()
    }

    /* ============================== 服务控制 ============================== */
    const ensureReady = async () => {
        if (!(await checkRoot())) { toast('没有开启高级功能（root），无法使用！', 'red', 5000); return false }
        if (!(await isInstall())) { toast('请先安装 CLNC 核心', 'red', 4000); return false }
        return true
    }

    const pollUntilRunning = (maxMs) => {
        POLL_TIMER && clearInterval(POLL_TIMER)
        const t0 = Date.now()
        let n = 0
        POLL_TIMER = setInterval(async () => {
            n++
            const st = await getStatus()
            if (st.running || Date.now() - t0 > (maxMs || 60000) || n > 40) {
                clearInterval(POLL_TIMER)
                POLL_TIMER = null
                await renderStatus()
                await readLog()
                if (st.running) toast('CLNC 已启动（pid ' + st.pid + '）', 'green')
                else toast('暂未检测到 CLNC 进程，请查看日志', 'pink', 6000)
            }
        }, 2500)
    }

    const doStart = async () => {
        if (!(await ensureReady())) return
        const st = await getStatus()
        if (st.running) return toast('CLNC 已在运行（pid ' + st.pid + '）', 'pink')
        const res = await sh(SERVICE + ' start', 30000)
        toast(res.content || '已发出启动命令', '', 4000)
        pollUntilRunning(60000)
    }

    const doStop = async () => {
        if (!(await ensureReady())) return
        const res = await sh(SERVICE + ' stop', 30000)
        toast(res.content || '已发出停止命令', '', 4000)
        // pid 很快就没了 → 先快速刷一次让按钮/状态灯跟着变；规则清理是后台做的，再补一次
        setTimeout(async () => { await renderStatus(); await readLog() }, 1200)
        setTimeout(async () => { await renderStatus(); await readLog() }, 4500)
    }

    const doRestart = async () => {
        if (!(await ensureReady())) return
        toast('正在重启 CLNC ...', '')
        const res = await sh(SERVICE + ' restart', 60000)
        toast(res.content || '已发出重启命令', '', 4000)
        pollUntilRunning(60000)
    }

    const doUninstall = (() => {
        let count = 0
        let timer = null
        return async () => {
            if (!(await checkRoot())) return toast('没有开启高级功能（root），无法使用！', 'red', 5000)
            timer && clearTimeout(timer)
            timer = setTimeout(() => { count = 0 }, 5000)
            if (count++ < 2) return toast('危险操作！再点 ' + (3 - count) + ' 次卸载 CLNC（含全部配置）', 'pink', 5000)
            count = 0
            toast('正在停止并清理...', '')
            await sh(SERVICE + ' stop', 30000)
            await new Promise((r) => setTimeout(r, 4000))
            const res = await sh('rm -rf ' + BASE + '; sed -i "/CLNC/d" ' + BOOT_SH + '; echo done')
            if (!res.content.includes('done')) return toast('卸载失败', 'red')
            INI_DIRTY = false
            toast('已卸载 CLNC（配置和日志一并删除）', 'green')
            await refreshAll(true)
        }
    })()

    /* ============================== config.ini 面板（直接编辑文本，不做快捷控件） ============================== */
    const readIni = async (force) => {
        const ta = $('#clnc_ini_text')
        if (!ta) return
        if (!force && INI_DIRTY) return
        const el = $('#clnc_ini_read_state')
        if (el) el.textContent = '读取中...'
        const res = await sh('timeout 2s awk \'{print}\' ' + INI_FILE)
        ta.value = res.content
        INI_DIRTY = false
        if (el) {
            el.textContent = res.content
                ? ('共 ' + res.content.split('\n').length + ' 行')
                : '没读到 ' + INI_FILE + '（先安装核心）'
        }
    }

    const saveIni = async () => {
        const ta = $('#clnc_ini_text')
        if (!ta) return
        const text = ta.value
        if (!text.trim()) return toast('config.ini 内容为空', 'red')
        if (!/^\s*modeName\s*=/m.test(text)) return toast('缺少 modeName 配置项，请检查内容', 'red', 5000)
        toast('正在保存 config.ini ...', '')
        if (!(await saveTextFile(text, 'config.ini', INI_FILE))) return toast('保存失败', 'red')
        INI_DIRTY = false
        toast('保存成功，需「重启」CLNC 生效', 'green', 5000)
        await readIni(true)
        await renderStatus()
    }

    /* ============================== 模式配置面板 ============================== */
    const refreshConfList = async () => {
        const sel = $('#clnc_conf_select')
        if (!sel) return
        const res = await sh('ls ' + BASE + '/*.conf 2>/dev/null')
        const list = res.content.split('\n')
            .map((x) => x.trim())
            .filter((x) => x.endsWith('.conf'))
            .map((x) => x.split('/').pop().replace(/\.conf$/, ''))
        const oldVal = sel.value
        sel.innerHTML = ''
        if (!list.length) {
            const o = document.createElement('option')
            o.value = ''
            o.textContent = '（未找到 .conf 配置）'
            sel.appendChild(o)
            return
        }
        list.forEach((name) => {
            const o = document.createElement('option')
            o.value = name
            o.textContent = name
            sel.appendChild(o)
        })
        if (list.includes(oldVal)) sel.value = oldVal
        const iniRes = await sh('timeout 2s awk \'{print}\' ' + INI_FILE)
        const ini = parseIni(iniRes.content)
        if (ini.modeName && list.includes(ini.modeName)) sel.value = ini.modeName
    }

    /* 下拉切换时自动调用；载入后清掉未保存标记 */
    const readConf = async (silent) => {
        const sel = $('#clnc_conf_select')
        const ta = $('#clnc_conf_text')
        if (!sel || !ta) return
        const mode = sel.value
        if (!mode) return toast('没有可编辑的配置', 'red')
        const res = await sh('timeout 2s awk \'{print}\' ' + BASE + '/' + mode + '.conf')
        ta.value = res.content
        CUR_MODE = mode
        CONF_DIRTY = false
        CONF_FORCE = false
        setConfState(res.content ? '' : '没读到 ' + mode + '.conf')
        if (silent !== true) toast('已载入 ' + mode + '.conf', 'green')
    }

    const setConfState = (extra) => {
        const el = $('#clnc_conf_state')
        if (!el) return
        if (extra) {
            el.textContent = extra
            el.style.color = '#ff6b6b'
            return
        }
        el.textContent = CONF_DIRTY ? '● 有未保存改动' : ''
        el.style.color = CONF_DIRTY ? '#ff9f43' : ''
    }

    const saveConf = async () => {
        const sel = $('#clnc_conf_select')
        const ta = $('#clnc_conf_text')
        if (!sel || !ta) return
        const mode = sel.value
        if (!mode) return toast('没有可保存的配置', 'red')
        if (!ta.value.trim()) return toast('配置内容为空', 'red')
        toast('正在保存 ' + mode + '.conf ...', '')
        if (!(await saveTextFile(ta.value, mode + '.conf', BASE + '/' + mode + '.conf'))) {
            return toast('保存失败', 'red')
        }
        CONF_DIRTY = false
        CONF_FORCE = false
        setConfState()
        toast('已保存 ' + mode + '.conf，回一级页面点「重启」生效', 'green', 5000)
        await refreshConfList()
        await renderStatus()
    }

    const useConf = async () => {
        const sel = $('#clnc_conf_select')
        if (!sel || !sel.value) return
        const mode = sel.value
        const cur = await sh('timeout 2s awk \'{print}\' ' + INI_FILE)
        if (!cur.content) return toast('读取 config.ini 失败', 'red')
        if (!(await saveTextFile(setIniValue(cur.content, 'modeName', mode), 'config.ini', INI_FILE))) {
            return toast('写入 modeName 失败', 'red')
        }
        const ta = $('#clnc_ini_text')
        if (ta) { ta.value = setIniValue(ta.value, 'modeName', mode); INI_DIRTY = false }
        toast('当前模式已设为 ' + mode + '，点「重启」生效', 'pink', 5000)
        await renderStatus()
    }

    /* ============================== 开机自启 ============================== */
    const checkIsBootUp = async () => {
        const res = await sh("grep -qxF '" + BOOT_LINE + "' " + BOOT_SH + ' && echo BOOT_YES || echo BOOT_NO')
        return res.content.includes('BOOT_YES')
    }

    const bootBtn = document.createElement('button')
    bootBtn.id = 'clnc_boot_on'
    bootBtn.className = 'clnc-btn clnc-t'
    bootBtn.textContent = '开机自启'
    bootBtn.style.background = ''
    bootBtn.addEventListener('click', async () => {
        if (!(await ensureReady())) return
        const isBoot = await checkIsBootUp()
        if (isBoot) {
            await sh('sed -i "/CLNC/d" ' + BOOT_SH)
            bootBtn.classList.remove('on')
            toast('已取消开机自启', 'green')
        } else {
            const res = await sh("grep -qxF '" + BOOT_LINE + "' " + BOOT_SH +
                " || echo '" + BOOT_LINE + "' >> " + BOOT_SH)
            if (!res.success) return toast('写入自启动脚本失败', 'red')
            bootBtn.classList.add('on')
            toast('已设置开机自启', 'green')
        }
    })

    /* ============================== CNS 模式配置生成面板 ============================== */
    const byId = (id) => document.getElementById(id)

    const CNS_FIELDS = [
        { k: 'addr', label: '服务器地址(ip:port 或域名)', group: '服务器' },
        { k: 'password', label: 'CNS 加密密码', group: '服务器' },
        { k: 'dnsAddr', label: 'DNS 地址(ip:port)', group: '服务器' },
        { k: 'ipVersion', label: '服务器 IP 版本', type: 'select', opts: ['', '4', '6'], labels: ['不限制', '只用 ipv4', '只用 ipv6'], group: '服务器' },
        { k: 'method', label: '请求方法', type: 'select', opts: ['GET', 'POST', 'CONNECT', 'WS'], group: '请求伪装' },
        { k: 'host', label: '请求头 Host', group: '请求伪装' },
        { k: 'url', label: '请求头 URL', group: '请求伪装' },
        { k: 'proxy_key', label: '代理头字段名', group: '请求伪装' },
        { k: 'udp_flag', label: 'UDP 标识', group: '请求伪装' },
        { k: 'tls_host', label: 'TLS 域名(留空=不启用)', group: '高级' },
        { k: 'tls_frontProxy', label: 'TLS 前置代理', type: 'select', opts: ['0', '1'], labels: ['关闭', '开启'], group: '高级' },
        { k: 'fakeDNS', label: '假 DNS(fake_dns)', type: 'select', opts: ['0', '1'], labels: ['关闭', '开启'], group: '高级' },
    ]

    const buildCnsForm = () => {
        const box = byId('clnc_cns_form')
        if (!box || box.dataset.built) return
        const groups = []
        CNS_FIELDS.forEach((f) => { if (groups.indexOf(f.group) < 0) groups.push(f.group) })
        groups.forEach((g) => {
            const sec = document.createElement('div')
            sec.className = 'clnc-sec'
            sec.textContent = g
            box.appendChild(sec)
            const grid = document.createElement('div')
            grid.className = 'clnc-grid'
            box.appendChild(grid)
            CNS_FIELDS.filter((f) => f.group === g).forEach((f) => {
                const wrap = document.createElement('label')
                wrap.className = 'clnc-field'
                const t = document.createElement('span')
                t.textContent = f.label
                wrap.appendChild(t)
                let el
                if (f.type === 'select') {
                    el = document.createElement('select')
                    el.className = 'clnc-sel'
                    ;(f.opts || []).forEach((v, i) => {
                        const o = document.createElement('option')
                        o.value = v
                        o.textContent = (f.labels ? f.labels[i] : v) + (v === '' ? '' : '（' + v + '）')
                        el.appendChild(o)
                    })
                } else {
                    el = document.createElement('input')
                    el.type = 'text'
                    el.spellcheck = false
                    el.className = 'clnc-in'
                }
                el.id = 'clnc_cns_' + f.k
                wrap.appendChild(el)
                grid.appendChild(wrap)
            })
        })
        box.dataset.built = '1'
    }

    const setCnsField = (key, value) => {
        const el = byId('clnc_cns_' + key)
        if (!el) return
        const v = value === undefined || value === null ? '' : String(value)
        if (el.tagName === 'SELECT' && !Array.from(el.options).some((o) => o.value === v)) {
            const o = document.createElement('option')
            o.value = v
            o.textContent = v
            el.appendChild(o)
        }
        el.value = v
    }

    const getCnsFields = () => {
        const v = {}
        CNS_FIELDS.forEach((f) => {
            const el = byId('clnc_cns_' + f.k)
            v[f.k] = el ? String(el.value).trim() : ''
        })
        return v
    }

    /* 按官方 cns配置N.ini 的格式生成内容（供 sh source，值都用单引号包起来） */
    const buildCnsIniText = (v) => {
        const q = (x) => "'" + String(x === undefined || x === null ? '' : x).replace(/'/g, '') + "'"
        return [
            '#cns配置，如果需要多个服务器负载均衡，请换行，在""内填信息',
            '#dns地址(尽量用服务器/etc/resolv.conf下的IP)',
            'dnsAddr=' + q(v.dnsAddr),
            '',
            '#服务器地址，支持域名',
            'addr=' + q(v.addr),
            '#cns加密密码',
            'password=' + q(v.password),
            '#服务器IP版本(4为只使用ipv4连接服务器, 6为只使用ipv6, 留空则为都使用)',
            'ipVersion=' + q(v.ipVersion),
            '#cns的代理头',
            'proxy_key=' + q(v.proxy_key),
            '#cns的UDP标识, 不懂就留默认',
            'udp_flag=' + q(v.udp_flag),
            '#请求方法(WS/GET/POST/CONNECT.....), WS为WebSocket',
            'method=' + q(v.method),
            '#请求头中的Host',
            'host=' + q(v.host),
            '#请求头的url',
            'url=' + q(v.url),
            '#tls域名(不开启tls则留空)',
            'tls_host=' + q(v.tls_host),
            '#tls前置代理(1开启, 用CONNECT代理tls, 一般不需要)',
            'tls_frontProxy=' + q(v.tls_frontProxy),
            '#假DNS(1开启, makeConfFile 会生成 fake_dns = on)',
            'fakeDNS=' + q(v.fakeDNS),
            '',
        ].join('\n')
    }

    const listCnsSlots = async () => {
        const res = await sh('ls ' + CNS_DIR + '/cns_*.ini 2>/dev/null')
        return res.content.split('\n').map((x) => x.trim()).filter(Boolean)
            .map((x) => x.split('/').pop().replace(/\.ini$/, ''))
    }

    /* 首次进入时，把官方 cns配置N.ini 复制成 ASCII 名的 cns_1.ini / cns_2.ini
       （命令里不出现中文，靠通配符拿文件名，避免不同 shell 编码差异） */
    const bootstrapCnsInis = async () => {
        const exist = await sh('ls ' + CNS_DIR + '/cns_*.ini 2>/dev/null')
        if (exist.content) return
        await sh('cd ' + CNS_DIR + ' 2>/dev/null; i=1; for f in *.ini; do ' +
            'case "$f" in cns_*) continue;; esac; [ -f cns_$i.ini ] || cp -f "$f" cns_$i.ini; i=$((i+1)); done')
    }

    const fillSlotSelect = (sel, slots, keep, withOff) => {
        if (!sel) return
        sel.innerHTML = ''
        if (withOff) {
            const o = document.createElement('option')
            o.value = ''
            o.textContent = '关闭'
            sel.appendChild(o)
        }
        slots.forEach((name) => {
            const o = document.createElement('option')
            o.value = name
            o.textContent = name
            sel.appendChild(o)
        })
        if (slots.includes(keep)) sel.value = keep
    }

    const refreshCnsPanel = async () => {
        buildCnsForm()
        await bootstrapCnsInis()
        const slots = await listCnsSlots()
        const st = byId('clnc_cns_state')
        if (!slots.length) {
            if (st) st.textContent = '未找到 cns_*.ini，请先「安装/更新核心」（核心包内含 makeCNSMode 工具）'
            return
        }
        const slotSel = byId('clnc_cns_slot')
        const cur = slotSel ? slotSel.value : ''
        fillSlotSelect(slotSel, slots, slots.includes(cur) ? cur : slots[0], false)
        const used = slotSel ? slotSel.value : slots[0]
        fillSlotSelect(byId('clnc_cns_ch'), slots.filter((x) => x !== used), '', true)
        if (st) st.textContent = '配置槽：' + slots.join(' / ') + '　（cns_1 来自官方 cns配置1.ini）'
    }

    const readCnsIni = async (showToast) => {
        const sel = byId('clnc_cns_slot')
        const slot = sel ? sel.value : ''
        if (!slot) return toast('请先选择服务器配置槽', 'red')
        const res = await sh('timeout 2s awk \'{print}\' ' + CNS_DIR + '/' + slot + '.ini')
        if (!res.content) return toast('读取失败：' + slot + '.ini 不存在或为空', 'red')
        const v = parseIni(res.content)
        CNS_FIELDS.forEach((f) => {
            let val = v[f.k]
            if (val === undefined) val = f.type === 'select' ? ((f.opts || [])[0] || '') : ''
            setCnsField(f.k, val)
        })
        if (showToast) toast('已读取 ' + slot + '.ini', 'green')
    }

    const saveCnsIni = async (silent) => {
        const sel = byId('clnc_cns_slot')
        const slot = sel ? sel.value : ''
        if (!slot) { toast('请先选择服务器配置槽', 'red'); return false }
        const v = getCnsFields()
        if (!v.addr) { toast('服务器地址不能为空', 'red'); return false }
        if (!silent) toast('正在保存 ' + slot + '.ini ...', '')
        if (!(await saveTextFile(buildCnsIniText(v), slot + '.ini', CNS_DIR + '/' + slot + '.ini'))) {
            toast('保存失败', 'red')
            return false
        }
        if (!silent) toast('已保存 ' + slot + '.ini', 'green')
        return true
    }

    const genCnsConfig = async (apply) => {
        if (!(await checkRoot())) return toast('没有开启高级功能（root），无法使用！', 'red', 5000)
        const hasTool = await sh('[ -f ' + CNS_DIR + '/makeConfFile ] && echo yes')
        if (!hasTool.content.includes('yes')) {
            return toast('缺少 makeCNSMode 工具目录，请先「安装/更新核心」', 'red', 6000)
        }
        const sel = byId('clnc_cns_slot')
        const slot = sel ? sel.value : ''
        if (!slot) return toast('请先选择服务器配置槽', 'red')
        const outEl = byId('clnc_cns_out')
        const out = ((outEl && outEl.value) || '').trim() || 'clnc_cns'
        if (!/^[A-Za-z0-9_.]+$/.test(out)) return toast('输出名只能用 字母/数字/下划线/点', 'red', 5000)
        const chEl = byId('clnc_cns_ch')
        const ch = (chEl && chEl.value) || ''
        // 生成前先把界面上的参数落盘，避免用到旧值
        if (!(await saveCnsIni(true))) return
        if (!(await saveTextFile(GEN_SH_TEXT, 'gen.sh', GEN_SH))) return toast('写入生成脚本失败', 'red')
        await sh('chmod 777 ' + GEN_SH)
        toast('正在生成 ' + out + '.conf ...', '')
        const res = await sh('sh ' + GEN_SH + ' ' + slot + ' ' + (ch || '-') + ' ' + out, 40000)
        if (!res.content.includes('已生成')) {
            return toast('生成失败：' + (res.content || '无输出，请查看日志'), 'red', 8000)
        }
        toast(res.content, 'green', 6000)
        await refreshConfList()
        if (!apply) return
        const iniNow = await sh('timeout 2s awk \'{print}\' ' + INI_FILE)
        if (!(await saveTextFile(setIniValue(iniNow.content, 'modeName', out), 'config.ini', INI_FILE))) {
            return toast('切换模式失败', 'red')
        }
        await readIni(true)
        toast('当前模式已切到 ' + out + '，正在重启 CLNC', 'green', 5000)
        await doRestart()
    }

    /* ============================== UI：紧凑卡片 + 弹窗编辑 ============================== */
    const mmContainer = document.querySelector('.functions-container')
    if (!mmContainer) return

    mmContainer.insertAdjacentHTML('afterend', `
        <div id="IFRAME_CLNC" style="width:100%;margin-top:10px;">
<style>
                .clnc-card{background:rgba(128,128,128,.10);border-radius:12px;padding:10px;}
                .clnc-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
                .clnc-kv{font-size:.68rem;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;}
                .clnc-sub{font-size:.62rem;opacity:.72;}
                .clnc-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;background:rgba(128,128,128,.09);border-radius:10px;padding:6px 8px;}
                .clnc-sec{font-size:.63rem;opacity:.65;margin:10px 0 4px;}
                .clnc-btn{margin:0 !important;padding:5px 10px;font-size:.68rem;border-radius:9px;line-height:1.25;border-left:3px solid transparent;}
                .clnc-g{background:rgba(76,175,80,.18);border-left-color:#4caf50;}
                .clnc-r{background:rgba(244,67,54,.16);border-left-color:#ef5350;}
                .clnc-b{background:rgba(33,150,243,.16);border-left-color:#42a5f5;}
                .clnc-y{background:rgba(255,152,0,.16);border-left-color:#ffa726;}
                .clnc-p{background:rgba(156,39,176,.16);border-left-color:#ba68c8;}
                .clnc-t{background:rgba(0,150,136,.16);border-left-color:#26a69a;}
                .clnc-n{background:rgba(128,128,128,.14);border-left-color:rgba(128,128,128,.5);}
                /* 状态：达成 → 同色实心；不可用 → 变暗；失败 → 红 */
                .clnc-g.on{background:rgba(76,175,80,.55);}
                .clnc-r.on{background:rgba(244,67,54,.50);}
                .clnc-b.on{background:rgba(33,150,243,.50);}
                .clnc-y.on{background:rgba(255,152,0,.50);}
                .clnc-p.on{background:rgba(156,39,176,.50);}
                .clnc-t.on{background:rgba(0,150,136,.50);}
                .clnc-n.on{background:rgba(128,128,128,.38);}
                .clnc-btn.dim{opacity:.42;}
                .clnc-btn.bad{background:rgba(244,67,54,.42);border-left-color:#ef5350;}
                .clnc-btn.on{background:var(--dark-btn-color-active);}
                .clnc-ta{width:100%;box-sizing:border-box;font-size:12px !important;border:none;padding:8px;border-radius:10px;background:rgba(128,128,128,.10);overflow-x:hidden;}
                .clnc-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.55;white-space:pre-wrap;word-break:break-all;}
                .clnc-sel,.clnc-in{font-size:.68rem;padding:5px 8px;border-radius:9px;border:none;background:rgba(128,128,128,.14);}
                .clnc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;}
                .clnc-field{display:flex;flex-direction:column;gap:3px;}
                .clnc-field>span{font-size:.62rem;opacity:.72;}
                .clnc-ip{font-family:monospace;font-size:.72rem;cursor:pointer;}
            </style>
            <div class="title" style="margin:6px 0;display:flex;align-items:center;gap:8px;">
                <strong>CLNC 网络代理</strong>
                <span id="clnc_dot" style="font-size:.72rem;color:#ff9f43;">●</span>
                <span id="clnc_head_state" class="clnc-sub">检测中...</span>
                <div style="margin-left:auto;display:inline-block;" id="collapse_CLNC_btn"></div>
            </div>
            <div class="collapse" id="collapse_CLNC" data-name="open" style="height:0px;overflow:hidden;">
                <div class="collapse_box">
                    <div class="clnc-card">
                        <div id="clnc_status_box" class="clnc-kv">
                            <span>状态：<span id="clnc_status_run">--</span></span>
                            <span>模式：<span id="clnc_status_mode">--</span></span>
                            <span>环境：<span id="clnc_status_env">--</span></span>
                            <span>核心：<span id="clnc_status_ver">--</span></span>
                            <span>出口IP：<span id="clnc_ip_val" class="clnc-ip" title="点一下复制">--</span></span>
                        </div>
                        <div class="clnc-row" style="margin-top:10px;">
                            <div id="clnc_run_btns" class="clnc-row"></div>
                            <span class="clnc-sub" id="clnc_hint" style="margin-left:auto;"></span>
                        </div>
                    </div>
                    <div class="clnc-row" style="margin-top:8px;">
                        <div id="clnc_srv_btns" class="clnc-row"></div>
                    </div>
                    <div class="clnc-card" style="margin-top:8px;">
                        <div class="clnc-row">
                            <span class="clnc-sub" style="min-width:56px;">核心源</span>
                            <input id="clnc_url_input" class="clnc-in" spellcheck="false"
                                placeholder="自备 .zip 直链，留空走内置镜像" style="flex:1;min-width:130px;">
                            <button class="clnc-btn clnc-p" onclick="clncSaveUrl()">保存</button>
                            <label class="clnc-row clnc-sub" style="gap:4px;cursor:pointer;">
                                <input type="checkbox" id="clnc_only_custom">只用自备
                            </label>
                        </div>
                        <div class="clnc-row" style="margin-top:6px;">
                            <span class="clnc-sub" style="min-width:56px;">自备脚本</span>
                            <input id="clnc_sh_input" class="clnc-in" spellcheck="false"
                                placeholder="自备 .sh 直链（以 root 执行，输出见下方）" style="flex:1;min-width:130px;">
                            <button class="clnc-btn clnc-y" onclick="clncRunScript()">下载并执行</button>
                        </div>
                        <textarea id="clnc_sh_out" class="clnc-ta" readonly spellcheck="false"
                            style="display:none;height:150px;margin-top:8px;"></textarea>
                    </div>
                    <div class="clnc-row" style="margin-top:8px;">
                        <div id="clnc_edit_btns" class="clnc-row"></div>
                    </div>
                </div>
            </div>
        </div>
    `)

    let BUSY = false
    let PANEL_TICK = null
    let LOG_TICK = null
    const BTN = {}   // 按钮引用，供状态配色使用

    const mkBtn = (text, fn, title, cls) => {
        const b = document.createElement('button')
        b.textContent = text
        if (title) b.title = title
        b.className = cls || 'clnc-btn'
        b.onclick = fn
        return b
    }

    /* ---------- 主操作按钮 ---------- */
    const runBox = $('#clnc_run_btns')
    BTN.start = mkBtn('启动', () => doStart(), '启动 CLNC（建 tun、写 iptables/路由规则）', 'clnc-btn clnc-g')
    BTN.stop = mkBtn('停止', () => doStop(), '停止并清理 iptables/路由规则', 'clnc-btn clnc-r')
    BTN.restart = mkBtn('重启', () => doRestart(), '先停止再启动', 'clnc-btn clnc-y')
    BTN.test = mkBtn('测试IP', () => testIp(false), '访问 ip.3322.net 看当前出口 IP（可对比开/关代理）', 'clnc-btn clnc-b')
    runBox.appendChild(BTN.start)
    runBox.appendChild(BTN.stop)
    runBox.appendChild(BTN.restart)
    runBox.appendChild(BTN.test)
    const ipEl = $('#clnc_ip_val')
    if (ipEl) ipEl.onclick = (e) => copyText(e)

    /* ---------- 维护按钮 ---------- */
    const srvBox = $('#clnc_srv_btns')
    BTN.install = mkBtn('安装/更新核心', () => doInstall(), '从自备源或 GitHub 镜像下载核心包；已安装则覆盖 Core/，不动你的配置', 'clnc-btn clnc-p')
    BTN.local = mkBtn('本地安装', () => doLocalInstall(), '选择手机里已有的 clnc 核心压缩包', 'clnc-btn clnc-n')
    BTN.uninstall = mkBtn('卸载 CLNC', () => doUninstall(), '删除 /data/CLNC 全部内容（需连点 3 次）', 'clnc-btn clnc-r')
    srvBox.appendChild(BTN.install)
    srvBox.appendChild(BTN.local)
    srvBox.appendChild(bootBtn)
    srvBox.appendChild(BTN.uninstall)

    /* ---------- 编辑入口按钮 ---------- */
    const editBox = $('#clnc_edit_btns')
    BTN.cfg = mkBtn('主配置', () => openConfigModal(), 'config.ini 全文编辑（读取/保存）', 'clnc-btn clnc-b')
    BTN.conf = mkBtn('模式配置', () => openConfModal(), '.conf 模式文件编辑', 'clnc-btn clnc-t')
    BTN.cns = mkBtn('生成CNS', () => openCnsModal(), '官方 makeCNSMode 图形化', 'clnc-btn clnc-p')
    BTN.log = mkBtn('日志', () => openLogModal(), '服务运行日志', 'clnc-btn clnc-n')
    editBox.appendChild(BTN.cfg)
    editBox.appendChild(BTN.conf)
    editBox.appendChild(BTN.cns)
    editBox.appendChild(BTN.log)

    /* ---------- 状态配色：达成=实心、不可用=变暗 ---------- */
    const setCls = (el, cls, yes) => { if (el && el.classList) el.classList[yes ? 'add' : 'remove'](cls) }

    let LAST_STATE = { installed: false, running: false, bootUp: false }
    const updateButtonStates = (patch) => {
        const st = Object.assign({}, LAST_STATE, patch || {})
        LAST_STATE = st
        const installed = Boolean(st.installed)
        const running = Boolean(st.running)
        setCls(BTN.start, 'on', running)          // 跑起来了 → 实心绿
        setCls(BTN.start, 'dim', !installed)
        setCls(BTN.stop, 'dim', !installed || !running)   // 没运行就没什么可停
        setCls(BTN.restart, 'dim', !installed)
        setCls(BTN.install, 'on', installed)      // 核心已就绪 → 实心紫
        setCls(BTN.boot, 'on', Boolean(st.bootUp))
        const dep = [BTN.cfg, BTN.conf, BTN.cns, BTN.log, BTN.uninstall, BTN.boot]
        dep.forEach((el) => setCls(el, 'dim', !installed))
    }

    /* ---------- 出口 IP 测试（一级页面） ---------- */
    const IP_TEST_URL = 'http://ip.3322.net/'
    const testIp = async (silent) => {
        const el = $('#clnc_ip_val')
        if (el) { el.textContent = '测试中...'; el.style.opacity = '.55' }
        const tool = await getDownloadTool()
        if (!tool) {
            if (el) { el.textContent = '无 curl/wget'; el.style.opacity = '1'; el.style.color = '#ff6b6b' }
            if (!silent) toast('设备上没找到 curl/wget，无法测试', 'red')
            return ''
        }
        const cmd = tool.kind === 'wget'
            ? 'timeout 10 ' + tool.path + ' -q -O - ' + IP_TEST_URL
            : 'timeout 10 ' + tool.path + ' -sL --connect-timeout 4 -m 9 ' + IP_TEST_URL
        const res = await sh(cmd, 14000)
        const ip = (res.content.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/) || [])[0] || ''
        if (el) {
            el.textContent = ip || '获取失败'
            el.style.opacity = '1'
            el.style.color = ip ? '' : '#ff6b6b'
        }
        setCls(BTN.test, 'on', Boolean(ip))     // 测通 → 实心蓝
        setCls(BTN.test, 'bad', !ip)             // 失败 → 红
        if (!silent) toast(ip ? '出口 IP：' + ip : '获取失败（代理没通或网络不通）', ip ? 'green' : 'red', 4000)
        return ip
    }

    /* ---------- 弹窗通用 ---------- */
    const modalBase = (name, title, content, width, onClose) => {
        if (typeof createModal !== 'function' || typeof showModal !== 'function') {
            toast('当前 UFI-TOOLS 版本不支持弹窗', 'red')
            return null
        }
        const old = document.getElementById(name)
        if (old) old.remove()
        const m = createModal({
            name: name,
            title: title,
            maxWidth: width || '520px',
            contentStyle: 'max-height:62vh;overflow:auto;',
            showConfirm: false,
            closeBtnText: '关闭',
            onClose: () => {
                if (onClose) onClose()
                return true
            },
            content: content,
        })
        if (!m) {
            toast('弹窗容器未就绪', 'red')
            return null
        }
        return m
    }

    /* ---------- 主配置 ---------- */
    const openConfigModal = async () => {
        const m = modalBase('clnc_cfg_modal', '主配置 config.ini', `
            <div class="clnc-bar">
                <button class="clnc-btn clnc-b" onclick="clncReadIni()">读取文件</button>
                <button class="clnc-btn clnc-p" onclick="clncSaveIni()">保存文件</button>
                <span class="clnc-sub" id="clnc_ini_read_state"></span>
            </div>
            <textarea id="clnc_ini_text" class="clnc-ta clnc-code" spellcheck="false" style="height:54vh;margin-top:8px;"></textarea>
            <div class="clnc-sub" style="margin-top:8px;">文件：/data/CLNC/config.ini　改完点「保存文件」，再回一级页面点「重启」生效</div>
        `, '560px', null)
        if (!m) return
        showModal(m.id)
        await readIni(true)
    }

    /* ---------- 模式配置 ---------- */
    const openConfModal = async () => {
        const m = modalBase('clnc_conf_modal', '模式配置 .conf', `
            <div class="clnc-bar">
                <select id="clnc_conf_select" class="clnc-sel" style="flex:1;min-width:120px;"></select>
                <button class="clnc-btn clnc-p" onclick="clncSaveConf()">保存</button>
                <button class="clnc-btn clnc-t" onclick="clncUseConf()">设为当前模式</button>
                <span class="clnc-sub" id="clnc_conf_state"></span>
            </div>
            <textarea id="clnc_conf_text" class="clnc-ta clnc-code" spellcheck="false" style="height:50vh;margin-top:8px;"></textarea>
            <div class="clnc-sub" style="margin-top:8px;">下拉切换即自动载入；保存后回一级页面点「重启」生效；「设为当前模式」会把 modeName 写进 config.ini</div>
        `, '640px', null)
        if (!m) return
        showModal(m.id)
        await refreshConfList()
        await readConf(true)
        const sel = $('#clnc_conf_select')
        const ta = $('#clnc_conf_text')
        if (ta) ta.addEventListener('input', () => { CONF_DIRTY = true; setConfState() })
        if (sel) {
            sel.onchange = async () => {
                // 有未保存改动时先提醒一次：把选择退回去，再选一次才真的切换
                if (CONF_DIRTY && !CONF_FORCE) {
                    CONF_FORCE = true
                    sel.value = CUR_MODE
                    toast('当前改动还没保存！再选一次会丢弃改动并载入新模式', 'pink', 5000)
                    return
                }
                CONF_FORCE = false
                await readConf(true)
            }
        }
    }

    /* ---------- 生成 CNS 配置 ---------- */
    const openCnsModal = async () => {
        const m = modalBase('clnc_cns_modal', '生成 CNS 模式配置（makeCNSMode）', `
            <div class="clnc-bar">
                <span class="clnc-sub">配置槽</span><select id="clnc_cns_slot" class="clnc-sel"></select>
                <span class="clnc-sub">国内分流</span><select id="clnc_cns_ch" class="clnc-sel"></select>
                <span class="clnc-sub">输出名</span><input id="clnc_cns_out" class="clnc-in" value="clnc_cns" spellcheck="false" style="width:110px;">
            </div>
            <div class="clnc-bar" style="margin-top:8px;">
                <button class="clnc-btn" onclick="clncGenRead()">读取参数</button>
                <button class="clnc-btn" onclick="clncGenSave()">保存参数</button>
                <button class="clnc-btn" onclick="clncGenBuild()">生成配置</button>
                <button class="clnc-btn on" onclick="clncGenApply()">生成并应用</button>
            </div>
            <div id="clnc_cns_form" style="margin-top:6px;"></div>
            <div id="clnc_cns_state" class="clnc-sub" style="color:#ff9f43;margin-top:6px;"></div>
            <div class="clnc-sub" style="margin-top:6px;">调官方 makeConfFile 拼出完整模式配置，输出 /data/CLNC/输出名.conf，生成后可在「模式配置」里看到</div>
        `, '720px', null)
        if (!m) return
        showModal(m.id)
        await refreshCnsPanel()
        await readCnsIni(false)
        const slotEl = byId('clnc_cns_slot')
        if (slotEl) {
            slotEl.onchange = async () => {
                const slots = (await listCnsSlots()).filter((x) => x !== slotEl.value)
                fillSlotSelect(byId('clnc_cns_ch'), slots, '', true)
                await readCnsIni(false)
            }
        }
    }

    /* ---------- 日志 ---------- */
    const openLogModal = async () => {
        const m = modalBase('clnc_log_modal', '运行日志', `
            <div class="clnc-bar">
                <button class="clnc-btn" onclick="clncReadLog()">刷新</button>
                <button class="clnc-btn" onclick="clncClearLog()">清空日志</button>
                <span class="clnc-sub">打开期间每 3 秒自动刷新最新 60 行</span>
            </div>
            <textarea id="clnc_log_text" class="clnc-ta" disabled spellcheck="false" style="height:52vh;margin-top:8px;"></textarea>
        `, '600px', () => {
            LOG_TICK && LOG_TICK()
            LOG_TICK = null
        })
        if (!m) return
        showModal(m.id)
        await readLog()
        LOG_TICK && LOG_TICK()
        LOG_TICK = requestInterval(() => {
            // 弹窗若被其它方式关掉，这里自愈停掉定时器，避免空转
            if (!$('#clnc_log_text')) { LOG_TICK && LOG_TICK(); LOG_TICK = null; return }
            readLog()
        }, 3000)
    }

    /* ---------- 一级页面：自备源 / 自备脚本 ---------- */
    const refreshBootState = async () => {
        try {
            const isBoot = await checkIsBootUp()
            bootBtn.classList[isBoot ? 'add' : 'remove']('on')
            return isBoot
        } catch (e) { return false }
    }

    const fillSourceInputs = () => {
        const urlEl = $('#clnc_url_input')
        const shEl = $('#clnc_sh_input')
        const onlyEl = $('#clnc_only_custom')
        if (urlEl) urlEl.value = localStorage.getItem(URL_KEY) || ''
        if (shEl) shEl.value = localStorage.getItem(SH_KEY) || ''
        if (onlyEl) onlyEl.checked = localStorage.getItem(ONLY_CUSTOM_KEY) === '1'
    }

    /* 自备脚本：下载 → 简单校验不是网页 → 以 root 执行 → 输出回显在下方框里
       （仓库没了/想自己装核心，就走这条路：脚本里把文件放进 /data/CLNC 即可） */
    const runCustomScript = async () => {
        if (!(await checkRoot())) return toast('没有开启高级功能（root），无法使用！', 'red', 5000)
        const el = $('#clnc_sh_input')
        const outEl = $('#clnc_sh_out')
        const url = el ? (el.value || '').trim() : ''
        if (!url) return toast('先在「自备脚本」里填 .sh 直链', 'red', 5000)
        if (!/^https?:\/\/.+/i.test(url)) return toast('脚本地址必须以 http:// 或 https:// 开头', 'red', 5000)
        localStorage.setItem(SH_KEY, url)
        DL_TOOL = null
        if (outEl) { outEl.style.display = 'block'; outEl.value = '正在下载 ' + url + ' ...' }
        toast('正在下载自备脚本...', '', 4000)
        const ok = await downloadFile(url, CUSTOM_SH_PATH, 1)
        if (!ok) {
            if (outEl) outEl.value = '下载失败：' + url
            return toast('脚本下载失败，检查地址与网络', 'red', 6000)
        }
        const head = await sh('head -n 1 ' + CUSTOM_SH_PATH + ' 2>/dev/null')
        if (/<(!DOCTYPE|html)/i.test(head.content)) {
            await sh('rm -f ' + CUSTOM_SH_PATH)
            if (outEl) outEl.value = '下载到的不是脚本（看着像网页），已丢弃\n' + head.content
            return toast('下载到的不是脚本（像网页），已丢弃', 'red', 6000)
        }
        await sh('chmod 777 ' + CUSTOM_SH_PATH)
        if (outEl) outEl.value = '下载完成，正在执行 ' + CUSTOM_SH_PATH + ' ...\n（最长 3 分钟，输出会显示在这里）'
        toast('脚本执行中，输出在下方框里', '', 5000)
        const res = await sh('cd /data && sh ' + CUSTOM_SH_PATH + ' 2>&1 | tail -n 60', 180000)
        const out = res.content || '（脚本没有产生输出）'
        if (outEl) outEl.value = '$ sh ' + CUSTOM_SH_PATH + '\n' + out + '\n\n（脚本文件保留在 ' + CUSTOM_SH_PATH + '）'
        toast('脚本执行结束', 'green', 4000)
        await renderStatus()
    }

    /* ---------- 暴露给弹窗内 onclick ---------- */
    window.clncTestIp = () => testIp(false)
    window.clncReadIni = async () => { await readIni(true) }
    window.clncSaveIni = () => saveIni()
    window.clncSaveConf = () => saveConf()
    window.clncUseConf = () => useConf()
    window.clncGenRead = () => readCnsIni(true)
    window.clncGenSave = () => saveCnsIni(false)
    window.clncGenBuild = () => genCnsConfig(false)
    window.clncGenApply = () => genCnsConfig(true)
    window.clncReadLog = async () => { await readLog() }
    window.clncClearLog = async () => {
        await sh('> ' + LOG_FILE)
        await readLog()
        toast('日志已清空', 'green')
    }
    window.clncSaveUrl = () => {
        const el = $('#clnc_url_input')
        const onlyEl = $('#clnc_only_custom')
        const v = el ? (el.value || '').trim() : ''
        const only = Boolean(onlyEl && onlyEl.checked)
        if (v) localStorage.setItem(URL_KEY, v)
        else localStorage.removeItem(URL_KEY)
        if (only) localStorage.setItem(ONLY_CUSTOM_KEY, '1')
        else localStorage.removeItem(ONLY_CUSTOM_KEY)
        DL_TOOL = null
        if (!v) toast('已清空自备源，安装时走内置镜像', 'green')
        else toast('已保存自备核心源' + (only ? '（只用自己的源）' : '（优先用，失败再走内置镜像）'), 'green', 4000)
    }
    window.clncRunScript = () => runCustomScript()

    /* ---------- 初始化 / 轮询 ---------- */
    const refreshAll = async () => {
        fillSourceInputs()
        await renderStatus()
        await bootstrapCnsInis()
        const bootUp = await refreshBootState()
        updateButtonStates({ bootUp })
        await testIp(true)
    }

    setTimeout(async () => {
        try { await refreshAll() } catch (e) { console.error('[CLNC] 初始化失败', e) }
    }, 700)

    const tick = async () => {
        if (BUSY) return
        BUSY = true
        try {
            await renderStatus()
            if ($('#clnc_log_text')) await readLog()
        } finally {
            BUSY = false
        }
    }

    collapseGen('#collapse_CLNC_btn', '#collapse_CLNC', STOR_KEY, (newVal) => {
        if (newVal === 'open') {
            PANEL_TICK && PANEL_TICK()
            PANEL_TICK = requestInterval(() => { tick() }, 6000)
        } else {
            PANEL_TICK && PANEL_TICK()
            PANEL_TICK = null
        }
    })

    if (localStorage.getItem(STOR_KEY) === 'open') {
        PANEL_TICK = requestInterval(() => { tick() }, 6000)
    }

})()
//</script >
