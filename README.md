# 📦 OpenWrt代理配置

&gt; 适用于 **Openclash** / **dae** / **nikki** 的配置文件以及一些杂项

---

## 📁 配置文件存放路径

| 项目 | 存放路径 | 说明 |
|:---|:---|:---|
| **Openclash** | `/etc/config` | openclash-UCI 系统配置文件 |
| **dae** | `/etc/dae/config.dae` | openwrt-dae 代理核心配置 |
| **nikki** | `/etc/config/nikki` | openwrt-Nikki 插件 UCI 配置 |
| **ZET-F50-clash.txt** | `UFI-TOOL/插件商店/上传` | 中兴F50/飞猫U20 clash插件 |
---

## 🚀 一键脚本

```
# 1. 更新系统管理菜单
bash <(curl -sSL https://gh.0507.dpdns.org/https://raw.githubusercontent.com/CoverUp137/rules/refs/heads/main/menu.sh)

# 2. 更新 Nikki GeoData 数据库
bash <(curl -sSL https://gh.0507.dpdns.org/https://raw.githubusercontent.com/CoverUp137/rules/refs/heads/main/nikki-geodata.sh)
```
