#!/bin/sh
# nikki geodata 一键下载脚本

set -e

TARGET_DIR="/etc/nikki/run"
mkdir -p "$TARGET_DIR"

echo "========================================"
echo "  Nikki GeoData 一键下载脚本"
echo "========================================"
echo ""

MODE="${1:-jsdelivr}"

if [ "$MODE" = "ghproxy" ]; then
    BASE="https://0507.dpdns.org/https://github.com"
    MMDB_URL="${BASE}/alecthw/mmdb_china_ip_list/releases/latest/download/Country.mmdb"
    GEOIP_URL="${BASE}/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat"
    GEOSITE_URL="${BASE}/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat"
    ASN_URL="${BASE}/xishang0128/geoip/releases/latest/download/GeoLite2-ASN.mmdb"
    echo "[模式] 使用 ghproxy 镜像加速"
else
    MMDB_URL="https://testingcf.jsdelivr.net/gh/alecthw/mmdb_china_ip_list@release/Country.mmdb"
    GEOIP_URL="https://testingcf.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geoip.dat"
    GEOSITE_URL="https://testingcf.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geosite.dat"
    ASN_URL="https://testingcf.jsdelivr.net/gh/xishang0128/geoip@release/GeoLite2-ASN.mmdb"
    echo "[模式] 使用 jsDelivr CDN（默认）"
    echo "        如果下载失败，请执行: sh $0 ghproxy"
fi

echo ""

download_file() {
    local url="$1"
    local output="$2"
    local name="$3"
    local min_size="$4"

    echo "[下载] $name ..."
    echo "       URL: $url"
    
    if curl -fsSL --connect-timeout 30 --max-time 120 "$url" -o "$output"; then
        local size
        size=$(wc -c < "$output" 2>/dev/null || echo 0)
        if [ "$size" -lt "$min_size" ]; then
            echo "[错误] $name 文件过小 (${size} bytes)，可能下载失败或被拦截"
            rm -f "$output"
            return 1
        fi
        echo "[成功] $name 已下载 (${size} bytes)"
        return 0
    else
        echo "[错误] $name 下载失败"
        rm -f "$output"
        return 1
    fi
}

echo "[清理] 删除旧文件..."
rm -f "$TARGET_DIR"/Country.mmdb
rm -f "$TARGET_DIR"/GeoIP.dat
rm -f "$TARGET_DIR"/GeoSite.dat
rm -f "$TARGET_DIR"/GeoLite2-ASN.mmdb

ERR=0

download_file "$MMDB_URL"    "$TARGET_DIR/Country.mmdb"      "Country.mmdb"      1000000 || ERR=1
download_file "$GEOIP_URL"   "$TARGET_DIR/GeoIP.dat"         "GeoIP.dat"         1000000 || ERR=1
download_file "$GEOSITE_URL" "$TARGET_DIR/GeoSite.dat"       "GeoSite.dat"       1000000 || ERR=1
download_file "$ASN_URL"     "$TARGET_DIR/GeoLite2-ASN.mmdb" "GeoLite2-ASN.mmdb" 1000000 || ERR=1

echo ""
echo "========================================"

if [ "$ERR" -eq 0 ]; then
    echo "[完成] 所有文件下载成功"
    echo ""
    ls -lh "$TARGET_DIR"/*.mmdb "$TARGET_DIR"/*.dat 2>/dev/null || true
    echo ""
    echo "[重启] 正在重启 nikki..."
    /etc/init.d/nikki restart
    echo "[完成] nikki 已重启"
else
    echo "[失败] 部分文件下载失败"
    echo ""
    echo "建议:"
    echo "  1. 检查路由器能否访问外网"
    echo "  2. 尝试使用 ghproxy 镜像:"
    echo "     sh $0 ghproxy"
    echo "  3. 或者手动下载后上传到 $TARGET_DIR"
    exit 1
fi
