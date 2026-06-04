import { BsFillInfoCircleFill } from "react-icons/bs";
import { IoCheckmark } from "react-icons/io5";
import { IoCloseOutline } from "react-icons/io5";
import { Button, Popover, Progress, Space, Typography } from "antd";

interface PasswordStrengthProps {
    value: number;
    has8Characters: boolean;
    hasLowercase: boolean;
    hasUppercase: boolean;
    hasNumber: boolean;
    hasSpecial: boolean;
}

export const PasswordStrength = ({
    value,
    has8Characters,
    hasLowercase,
    hasUppercase,
    hasNumber,
    hasSpecial,
}: PasswordStrengthProps) => {
    const getStatus = () => {
        if (value <= 20) return { status: "exception" as const, label: "Very weak", color: "#ff4d4f" };
        if (value <= 40) return { status: "exception" as const, label: "Weak", color: "#fa8c16" };
        if (value <= 60) return { status: "normal" as const, label: "Fair", color: "#fadb14" };
        if (value <= 80) return { status: "normal" as const, label: "Strong", color: "#52c41a" };
        return { status: "success" as const, label: "Very strong", color: "#389e0d" };
    };

    const status = getStatus();

    const rules = [
        { label: "Contains at least 8 characters", passed: has8Characters },
        { label: "Contains a lowercase letter", passed: hasLowercase },
        { label: "Contains an uppercase letter", passed: hasUppercase },
        { label: "Contains a number", passed: hasNumber },
        { label: "Contains a special character", passed: hasSpecial },
    ];

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
            <div style={{ flex: 1 }}>
                <Space direction="vertical" size={6} style={{ width: "100%" }}>
                    <Typography.Text style={{ color: "#d9d9d9", fontSize: 12, letterSpacing: 0.3 }}>
                        Password Strength
                    </Typography.Text>
                    <Progress
                        percent={value}
                        status={status.status}
                        showInfo={false}
                        strokeColor={status.color}
                        trailColor="#3a3a3a"
                    />
                    <Typography.Text style={{ color: "#8c8c8c", fontSize: 12 }}>
                        {status.label}
                    </Typography.Text>
                </Space>
            </div>

            <Popover
                overlayStyle={{
                    "--antd-arrow-background-color": "#202731",
                } as React.CSSProperties}
                trigger="click"
                placement="bottomRight"
                styles={{
                    body: {
                        background: "#202731",
                        color: "#fff",
                    },
                }}
                content={
                    <div style={{ width: 260 }}>
                        <Space direction="vertical" size={10} style={{ width: "100%" }}>
                            <Typography.Text strong style={{ color: "#fff" }}>
                                Password rules
                            </Typography.Text>

                            {rules.map((rule) => (
                                <div
                                    key={rule.label}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                    }}
                                >
                                    {rule.passed ? (
                                        <IoCheckmark color="#52c41a" size={16} />
                                    ) : (
                                        <IoCloseOutline color="#ff4d4f" size={16} />
                                    )}

                                    <Typography.Text
                                        style={{
                                            color: "#d9d9d9",
                                            fontSize: 13,
                                        }}
                                    >
                                        {rule.label}
                                    </Typography.Text>
                                </div>
                            ))}
                        </Space>
                    </div>
                }
            >
                <Button
                    type="text"
                    shape="circle"
                    icon={<BsFillInfoCircleFill />}
                />
            </Popover>
        </div>
    );
};
