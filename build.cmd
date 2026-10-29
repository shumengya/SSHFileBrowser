@echo off
chcp 65001 >nul
rem 一键构建:前端打包进 backend\web\dist,再编译成单个 exe 放到 bin 目录
rem 版本号:先 set VERSION=1.0.0 再运行;不设置就用构建日期
setlocal
cd /d "%~dp0"

if "%VERSION%"=="" for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy.MM.dd"') do set VERSION=%%i

echo [1/3] 安装前端依赖...
pushd frontend
call pnpm install --frozen-lockfile
if errorlevel 1 goto :fail

echo [2/3] 构建前端...
call pnpm build
if errorlevel 1 goto :fail
popd

echo [3/3] 编译后端(版本 %VERSION%)...
if not exist bin mkdir bin
pushd backend
go build -trimpath -ldflags "-s -w -X main.version=%VERSION%" -o ..\bin\sshfilebrowser.exe .
if errorlevel 1 goto :fail
popd

echo.
echo 构建完成: %~dp0bin\sshfilebrowser.exe
echo 双击运行即可,数据保存在 bin\data 目录。
exit /b 0

:fail
popd
echo.
echo 构建失败,请查看上面的错误信息。
exit /b 1